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
        // 检查是否配置了KV数据库
        // if (typeof env.img_url == "undefined" || env.img_url == null || env.img_url == "") {
        //    return new Response('Error: Please configure KV database', { status: 500 });
        // }

        // const kv = env.img_url;
        // let list = await kv.get("manage@blockipList");
        // if (list == null) {
        //     list = [];
        // } else {
        //     list = list.split(",");
        // }

        // 检查是否配置了D1数据库
        if (typeof env.DB == "undefined" || env.DB == null) {
            return new Response('Error: Please configure D1 database', { status: 500 });
        }

        // const kv = env.img_url;
        const DB = env.DB;
        // let list = await kv.get("manage@blockipList");
        const stmtSelect = DB.prepare('SELECT config_value FROM system_configs WHERE config_key = ?');
        const result = await stmtSelect.bind('manage@blockipList').first();
        let listStr = result ? result.config_value : null;

        if (listStr == null) {
            list = [];
        } else {
            // list = list.split(",");
            list = listStr.split(",");
        }

        //从请求body中获取要block的ip
        const ip = await request.text();
        if (ip == null || ip == "") {
            return new Response('Error: Please input ip', { status: 400 });
        }

        //将ip添加到list中
        list.push(ip);
        // await kv.put("manage@blockipList", list.join(","));
        const stmtUpdate = DB.prepare('INSERT OR REPLACE INTO system_configs (config_key, config_value) VALUES (?, ?)');
        await stmtUpdate.bind('manage@blockipList', list.join(",")).run();

        return new Response('Add ip to block list successfully', { status: 200 });
    } catch (e) {
        return new Response('Add ip to block list failed', { status: 500 });
    }
}