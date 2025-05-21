export async function onRequest(context) {
    // 其他设置相关，GET方法读取设置，POST方法保存设置
    const {
      request, // same as existing Worker API
      env, // same as existing Worker API
      params, // if filename includes [id] or [[path]]
      waitUntil, // same as ctx.waitUntil in existing Worker API
      next, // used for middleware or to fetch assets
      data, // arbitrary space for passing data between middlewares
    } = context;

    const DB = env.DB;

    // GET读取设置
    if (request.method === 'GET') {
        const settings = await getOthersConfig(DB, env)

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    // POST保存设置
    if (request.method === 'POST') {
        const body = await request.json()
        const settings = body

        // 写入 D1
        const stmt = DB.prepare('INSERT OR REPLACE INTO system_configs (config_key, config_value) VALUES (?, ?)');
        await stmt.bind('manage@sysConfig@others', JSON.stringify(settings)).run();

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

}

export async function getOthersConfig(DB, env) {
    const settings = {}
    // 读取D1中的设置
    const stmt = DB.prepare('SELECT config_value FROM system_configs WHERE config_key = ?');
    const result = await stmt.bind('manage@sysConfig@others').first();
    const settingsStr = result ? result.config_value : null;
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {}

    // 远端遥测
    settings.telemetry = {
        enabled: !env.disable_telemetry === 'true',
        fixed: false,
    }

    // 随机图API
    settings.randomImageAPI = {
        enabled: env.AllowRandom === 'true',
        allowedDir: '',
        fixed: false,
    }

    // CloudFlare API Token
    settings.cloudflareApiToken = {
        CF_ZONE_ID: env.CF_ZONE_ID,
        CF_EMAIL: env.CF_EMAIL,
        CF_API_KEY: env.CF_API_KEY,
        fixed: false,
    }

    // 用KV存储的设置覆盖默认设置
    for (const key in settings) {
        Object.assign(settings[key], settingsKV[key])
    }

    return settings;
}