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
        const info = await stmt.bind('White', fileId).run();

        if (info.success && info.changes > 0) {
            return new Response(JSON.stringify({ success: true, message: `File ${fileId} added to whitelist.` }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } else if (info.success && info.changes === 0) {
            return new Response(JSON.stringify({ success: false, error: 'File not found or no change made.' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            const errorMessage = info.error || 'Failed to update file status in D1.';
            console.error("D1 update error for white:", errorMessage);
            return new Response(JSON.stringify({ success: false, error: errorMessage }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    } catch (e) {
        console.error("Error in white operation:", e);
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 400, 
            headers: { 'Content-Type': 'application/json' },
        });
    }
}