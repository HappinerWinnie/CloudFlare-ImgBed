export async function onRequest(context) {
    // Contents of context object
    const {
      request, // same as existing Worker API
      env, // same as existing Worker API
      params, // if filename includes [id] or [[path]]
      waitUntil, // same as ctx.waitUntil in existing Worker API
      next, // used for middleware or to fetch assets
      data, // arbitrary space for passing data between middlewares
    } = context;
    try {
        // 检查是否配置了D1数据库
        if (typeof env.DB == "undefined" || env.DB == null) {
            return new Response('Error: Please configure D1 database', { status: 500 });
        }

        const DB = env.DB;
        const stmt = DB.prepare('SELECT config_value FROM system_configs WHERE config_key = ?');
        const result = await stmt.bind('manage@blockipList').first();
        const list = result ? result.config_value : null;

        if (list == null) {
            return new Response('', { status: 200 });
        } else {
            return new Response(list, { status: 200 });
        }
    } catch (e) {
        return new Response('fetch block ip list failed', { status: 500 });
    }
}