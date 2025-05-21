import { purgeCFCache } from "../../../utils/purgeCache";

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    // 检查D1数据库是否配置
    if (typeof env.DB === "undefined" || env.DB === null) {
        return new Response('Error: Please configure D1 database', { status: 500 });
    }
    const DB = env.DB;

    try {
        // 解码params.path并将其作为fileId
        const fileId = decodeURIComponent(params.path.join('/'));

        const stmt = DB.prepare('UPDATE image_metadata SET list_type = ? WHERE id = ?');
        const info = await stmt.bind('Block', fileId).run();

        if (info.success && info.changes > 0) {
            // 清除CDN缓存等操作可以放在这里，如果需要
            // await purgeAssociatedCaches(env, fileId, new URL(request.url).origin);
            return new Response(JSON.stringify({ success: true, message: `File ${fileId} blocked.` }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } else if (info.success && info.changes === 0) {
            return new Response(JSON.stringify({ success: false, error: 'File not found or no change made.' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            // info.success is false or other errors
            const errorMessage = info.error || 'Failed to update file status in D1.';
            console.error("D1 update error for block:", errorMessage);
            return new Response(JSON.stringify({ success: false, error: errorMessage }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    } catch (e) {
        console.error("Error in block operation:", e);
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 400, // Or 500 depending on the nature of e
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// 可选：辅助函数清除缓存 (如果需要，可以从其他文件引入或在此定义)
// async function purgeAssociatedCaches(env, fileId, origin) {
//     const cdnUrl = `${origin}/file/${fileId}`;
//     await purgeCFCache(env, cdnUrl); // Assuming purgeCFCache is available
//     // Clear other related caches like randomFileList if fileId structure helps determine folder
// }