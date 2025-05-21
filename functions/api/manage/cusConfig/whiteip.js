export async function onRequest(context) {
    const {
      request,
      env,
    } = context;

    if (typeof env.DB === "undefined" || env.DB === null) {
        return new Response(JSON.stringify({ error: 'D1 database not configured' }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
    const DB = env.DB;
    const configKey = 'manage@whiteipList'; // Specific key for IP whitelist

    try {
        // For GET request, return the current whitelist
        if (request.method === 'GET') {
            const stmtSelect = DB.prepare('SELECT config_value FROM system_configs WHERE config_key = ?');
            const result = await stmtSelect.bind(configKey).first();
            const listStr = result ? result.config_value : '[]'; // Default to empty JSON array string
            // Assuming the list is stored as a JSON array string: e.g., "[\"ip1\",\"ip2\"]"
            // Or as a comma-separated string: "ip1,ip2"
            // Let's assume comma-separated for consistency with blockipList, but JSON array is safer.
            // For this implementation, stick to comma-separated for now.
            return new Response(listStr || '' , { 
                status: 200,
                headers: { 'Content-Type': 'text/plain' } // KV returned plain text
            });
        }

        const ip = await request.text();
        if (!ip || ip.trim() === "") {
            return new Response(JSON.stringify({ error: 'Please input IP' }), {
                status: 400, headers: { "Content-Type": "application/json" }
            });
        }

        // Fetch current list
        const stmtSelect = DB.prepare('SELECT config_value FROM system_configs WHERE config_key = ?');
        const result = await stmtSelect.bind(configKey).first();
        let listStr = result ? result.config_value : null;
        let listArray = listStr ? listStr.split(',').filter(Boolean) : []; // Filter out empty strings

        if (request.method === 'POST') { // Add IP to whitelist
            if (!listArray.includes(ip)) {
                listArray.push(ip);
            }
            const stmtUpdate = DB.prepare('INSERT OR REPLACE INTO system_configs (config_key, config_value) VALUES (?, ?)');
            await stmtUpdate.bind(configKey, listArray.join(',')).run();
            return new Response(JSON.stringify({ success: true, message: `IP ${ip} added to whitelist.` }), {
                status: 200, headers: { "Content-Type": "application/json" }
            });
        } else if (request.method === 'DELETE') { // Remove IP from whitelist
            listArray = listArray.filter(item => item !== ip);
            const stmtUpdate = DB.prepare('INSERT OR REPLACE INTO system_configs (config_key, config_value) VALUES (?, ?)');
            await stmtUpdate.bind(configKey, listArray.join(',')).run();
            return new Response(JSON.stringify({ success: true, message: `IP ${ip} removed from whitelist.` }), {
                status: 200, headers: { "Content-Type": "application/json" }
            });
        } else {
            return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                status: 405, headers: { "Content-Type": "application/json" }
            });
        }
    } catch (e) {
        console.error(`Error in ${configKey} operation:`, e);
        return new Response(JSON.stringify({ error: `Failed to update ${configKey}.`, details: e.message }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
}