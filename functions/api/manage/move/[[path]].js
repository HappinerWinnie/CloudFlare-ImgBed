import { S3Client, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { purgeCFCache } from "../../../utils/purgeCache";

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);

    // 读取目标文件夹
    const dist = url.searchParams.get('dist')
        ? url.searchParams.get('dist').replace(/^\/+/, '')
            .replace(/\/{2,}/g, '/')
            .replace(/\/$/, '')
        : '';

    // 读取folder参数，判断是否为文件夹移动请求
    const folder = url.searchParams.get('folder');
    if (folder === 'true') {
        try {
            params.path = decodeURIComponent(params.path);
            // 使用队列存储需要处理的文件夹
            const folderQueue = [{
                path: params.path.split(',').join('/'),
                dist: dist
            }];

            const processedFiles = [];
            const failedFiles = [];

            while (folderQueue.length > 0) {
                const currentFolder = folderQueue.shift();
                const curFolderName = currentFolder.path.split('/').pop();
                
                // 获取指定目录下的所有文件
                const listUrl = new URL(`${url.origin}/api/manage/list?count=-1&dir=${currentFolder.path}`);
                const listRequest = new Request(listUrl, request);
                const listResponse = await fetch(listRequest);
                const listData = await listResponse.json();

                const files = listData.files;
                const folderDist = currentFolder.dist === '' ? curFolderName : `${currentFolder.dist}/${curFolderName}`;

                // 处理当前文件夹下的所有文件
                for (const file of files) {
                    const fileId = file.name;
                    const fileName = file.name.split('/').pop();
                    const newFileId = `${folderDist}/${fileName}`;
                    const cdnUrl = `https://${url.hostname}/file/${fileId}`;

                    const success = await moveFile(env, fileId, newFileId, cdnUrl, url);
                    if (success) {
                        processedFiles.push(fileId);
                    } else {
                        failedFiles.push(fileId);
                    }
                }

                // 将子文件夹添加到队列
                const directories = listData.directories;
                for (const dir of directories) {
                    folderQueue.push({
                        path: dir,
                        dist: folderDist
                    });
                }
            }

            // 返回处理结果
            return new Response(JSON.stringify({
                success: true,
                processed: processedFiles,
                failed: failedFiles
            }));

        } catch (e) {
            return new Response(JSON.stringify({
                success: false,
                error: e.message
            }), { status: 400 });
        }
    }

    // 单个文件移动处理
    try {
        // 解码params.path
        params.path = decodeURIComponent(params.path);
        const fileId = params.path.split(',').join('/');
        const fileKey = fileId.split('/').pop();
        const newFileId = dist === '' ? fileKey : `${dist}/${fileKey}`;
        const cdnUrl = `https://${url.hostname}/file/${fileId}`;

        const success = await moveFile(env, fileId, newFileId, cdnUrl, url);
        if (!success) {
            throw new Error('Move file failed');
        }

        return new Response(JSON.stringify({
            success: true,
            fileId: fileId,
            newFileId: newFileId
        }));
    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), { status: 400 });
    }
}

// 移动单个文件的核心函数
async function moveFile(env, fileId, newFileId, cdnUrl, url) {
    try {
        // 读取图片信息 D1
        const stmtSelect = env.DB.prepare('SELECT * FROM image_metadata WHERE id = ?');
        const dbRecord = await stmtSelect.bind(fileId).first();

        if (!dbRecord) {
            console.warn(`Metadata for ${fileId} not found in D1 for moving.`);
            return false; 
        }

        // Create a mutable copy for new metadata
        const newDbRecord = { ...dbRecord };
        newDbRecord.id = newFileId; // Update ID for the new record
        newDbRecord.folder_path = newFileId.split('/').slice(0, -1).join('/') || 'root';

        // 旧版 Telegram 渠道和 Telegraph 渠道不支持移动 (value_placeholder might be relevant for TelegramNew)
        if (dbRecord.storage_channel === 'Telegram' || dbRecord.storage_channel === undefined) {
            // Check original KV's behavior for undefined channel. Here we assume it means old Telegraph
             throw new Error('Unsupported Channel for move: ' + dbRecord.storage_channel);
        }


        // 如果是R2渠道的图片，需要移动R2中对应的图片
        if (dbRecord.storage_channel === 'CloudflareR2') {
            const R2DataBase = env.img_r2;
            const object = await R2DataBase.get(fileId);
            if (!object) {
                throw new Error('R2 Object Not Found during move');
            }
            await R2DataBase.put(newFileId, object.body);
            await R2DataBase.delete(fileId);
        }

        // S3 渠道的图片，需要移动S3中对应的图片
        if (dbRecord.storage_channel === 'S3') {
            // Pass env to moveS3File for S3 credentials
            // Construct a partial metadata object for moveS3File, similar to what old code expected
            const s3Metadata = {
                S3Region: dbRecord.s3_region,
                S3Endpoint: dbRecord.s3_endpoint,
                S3BucketName: dbRecord.s3_bucket_name,
                S3FileKey: dbRecord.s3_file_key 
            };
            const { success, newKey: s3NewKey, error } = await moveS3File(env, { metadata: s3Metadata }, newFileId);
            if (success) {
                newDbRecord.s3_file_key = s3NewKey;
                const s3ServerDomain = dbRecord.s3_endpoint.replace(/https?:\/\//, "");
                newDbRecord.s3_location = `https://${dbRecord.s3_bucket_name}.${s3ServerDomain}/${s3NewKey}`;
            } else {
                throw new Error('S3 Move Failed: ' + error);
            }
        }
        
        // 更新D1存储
        // 1. 插入新记录
        const stmtInsert = env.DB.prepare(`
            INSERT INTO image_metadata (
                id, file_name, file_type, file_size_mb, upload_ip, upload_address,
                timestamp, folder_path, storage_channel, channel_name,
                s3_location, s3_endpoint, s3_region, s3_bucket_name, s3_file_key, value_placeholder
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);
        await stmtInsert.bind(
            newDbRecord.id, newDbRecord.file_name, newDbRecord.file_type, newDbRecord.file_size_mb,
            newDbRecord.upload_ip, newDbRecord.upload_address, newDbRecord.timestamp, newDbRecord.folder_path,
            newDbRecord.storage_channel, newDbRecord.channel_name,
            newDbRecord.s3_location, newDbRecord.s3_endpoint, newDbRecord.s3_region,
            newDbRecord.s3_bucket_name, newDbRecord.s3_file_key,
            dbRecord.value_placeholder
        ).run();

        // 2. 删除旧记录
        const stmtDelete = env.DB.prepare('DELETE FROM image_metadata WHERE id = ?');
        await stmtDelete.bind(fileId).run();

        // 更新文件夹信息
        const folderPath = newFileId.split('/').slice(0, -1).join('/');
        newDbRecord.folder_path = folderPath;
        
        // 清除CDN缓存
        await purgeCFCache(env, cdnUrl);

        // 清除randomFileList API缓存
        try {
            const cache = caches.default;
            const nullResponse = new Response(null, {
                headers: { 'Cache-Control': 'max-age=0' },
            });
            
            const normalizedFolder = fileId.split('/').slice(0, -1).join('/');
            const normalizedDist = newFileId.split('/').slice(0, -1).join('/');
            await cache.put(`${url.origin}/api/randomFileList?dir=${normalizedFolder}`, nullResponse);
            await cache.put(`${url.origin}/api/randomFileList?dir=${normalizedDist}`, nullResponse);
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }

        return true;
    } catch (e) {
        console.error('Move file failed:', e);
        return false;
    }
}

// 移动 S3 渠道的图片
async function moveS3File(env, img, newFileId) {
    const s3Client = new S3Client({
        region: img.metadata?.S3Region || "auto",
        endpoint: img.metadata?.S3Endpoint,
        credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY
        },
    });

    const bucketName = img.metadata?.S3BucketName;
    const oldKey = img.metadata?.S3FileKey;
    const newKey = newFileId;

    try {
        // 复制文件到新位置
        await s3Client.send(new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: `/${bucketName}/${oldKey}`,
            Key: newKey,
        }));

        // 复制成功后，删除旧文件
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: oldKey,
        }));

        // 返回新的 S3 文件信息
        return { success: true, newKey };
    } catch (error) {
        console.error("S3 Move Failed:", error);
        return { success: false, error: error.message };
    }
}