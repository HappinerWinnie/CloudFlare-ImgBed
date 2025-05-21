import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { purgeCFCache } from "../../../utils/purgeCache";

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);

    // 读取folder参数，判断是否为文件夹删除请求
    const folder = url.searchParams.get('folder');
    if (folder === 'true') {
        try {
            params.path = decodeURIComponent(params.path);
            // 使用队列存储需要处理的文件夹
            const folderQueue = [{
                path: params.path.split(',').join('/')
            }];

            const deletedFiles = [];
            const failedFiles = [];

            while (folderQueue.length > 0) {
                const currentFolder = folderQueue.shift();
                
                // 获取指定目录下的所有文件
                const listUrl = new URL(`${url.origin}/api/manage/list?count=-1&dir=${currentFolder.path}`);
                const listRequest = new Request(listUrl, request);
                const listResponse = await fetch(listRequest);
                const listData = await listResponse.json();

                const files = listData.files;

                // 处理当前文件夹下的所有文件
                for (const file of files) {
                    const fileId = file.name;
                    const cdnUrl = `https://${url.hostname}/file/${fileId}`;

                    const success = await deleteFile(env, fileId, cdnUrl, url);
                    if (success) {
                        deletedFiles.push(fileId);
                    } else {
                        failedFiles.push(fileId);
                    }
                }

                // 将子文件夹添加到队列
                const directories = listData.directories;
                for (const dir of directories) {
                    folderQueue.push({
                        path: dir
                    });
                }
            }


            // 返回处理结果
            return new Response(JSON.stringify({
                success: true,
                deleted: deletedFiles,
                failed: failedFiles
            }));

        } catch (e) {
            return new Response(JSON.stringify({
                success: false,
                error: e.message
            }), { status: 400 });
        }
    }

    // 单个文件删除处理
    try {
        // 解码params.path
        params.path = decodeURIComponent(params.path);
        const fileId = params.path.split(',').join('/');
        const cdnUrl = `https://${url.hostname}/file/${fileId}`;

        const success = await deleteFile(env, fileId, cdnUrl, url);
        if (!success) {
            throw new Error('Delete file failed');
        }

        return new Response(JSON.stringify({
            success: true,
            fileId: fileId
        }));
    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), { status: 400 });
    }
}

// 删除单个文件的核心函数
async function deleteFile(env, fileId, cdnUrl, url) {
    try {
        // 读取图片信息 D1
        const stmtSelect = env.DB.prepare('SELECT * FROM image_metadata WHERE id = ?');
        const dbRecord = await stmtSelect.bind(fileId).first();

        if (!dbRecord) {
            // If record not in D1, maybe it was only in KV (during migration phase) or truly doesn't exist.
            // For now, assume if not in D1, it's an error or already deleted.
            // Optionally, could try to delete from KV if dbRecord is null, as a fallback during transition.
            console.warn(`Metadata for ${fileId} not found in D1 for deletion.`);
            // To maintain similar behavior to KV, if not found, KV getWithMetadata would return null, and img.metadata would be undefined.
            // We can simulate this for channel checks, or just return false early.
             return false; // Or throw new Error('File metadata not found in D1') if strict.
        }

        // Reconstruct a partial metadata object similar to what old code expected, if needed for S3/R2 deletion logic
        const metadata = {
            Channel: dbRecord.storage_channel,
            S3Region: dbRecord.s3_region,
            S3Endpoint: dbRecord.s3_endpoint,
            // S3AccessKeyId & S3SecretAccessKey should be read from env for deleteS3File
            S3BucketName: dbRecord.s3_bucket_name,
            S3FileKey: dbRecord.s3_file_key
        };
        // The img object in original code had img.metadata and img.value.
        // We only need metadata for channel checks and S3 deletion details.
        const img = { metadata: metadata }; 

        // 如果是R2渠道的图片，需要删除R2中对应的图片
        if (img.metadata?.Channel === 'CloudflareR2') {
            const R2DataBase = env.img_r2;
            await R2DataBase.delete(fileId); // R2 key is the fileId
        }

        // S3 渠道的图片，需要删除S3中对应的图片
        if (img.metadata?.Channel === 'S3') {
            // Pass env to deleteS3File to access S3 credentials from environment variables
            const success = await deleteS3File(env, img); // img now contains D1 based metadata
            if (!success) {
                throw new Error('S3 Delete Failed');
            }
        }

        // 删除D1存储中的记录
        const stmtDelete = env.DB.prepare('DELETE FROM image_metadata WHERE id = ?');
        const deleteResult = await stmtDelete.bind(fileId).run();
        
        // Check if delete was successful (optional, run() might throw on error)
        // if (deleteResult.changes === 0) {
        //    console.warn(`No record deleted from D1 for ${fileId}, might have been already deleted.`);
        // }

        // 清除CDN缓存
        await purgeCFCache(env, cdnUrl);

        // 清除randomFileList API缓存
        try {
            const cache = caches.default;
            const nullResponse = new Response(null, {
                headers: { 'Cache-Control': 'max-age=0' },
            });
            
            const normalizedFolder = fileId.split('/').slice(0, -1).join('/');
            await cache.put(`${url.origin}/api/randomFileList?dir=${normalizedFolder}`, nullResponse);
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }

        return true;
    } catch (e) {
        console.error('Delete file failed:', e);
        return false;
    }
}

// 删除 S3 渠道的图片
async function deleteS3File(env, img) {
    const s3Client = new S3Client({
        region: img.metadata?.S3Region || "auto",
        endpoint: img.metadata?.S3Endpoint,
        credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY
        },
    });

    const bucketName = img.metadata?.S3BucketName;
    const key = img.metadata?.S3FileKey;

    try {
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
        }));
        return true;
    } catch (error) {
        console.error("S3 Delete Failed:", error);
        return false;
    }
}