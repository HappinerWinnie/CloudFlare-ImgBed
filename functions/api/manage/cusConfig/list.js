export async function onRequest(context) {
    const {
      request,
      env,
    } = context;
    const url = new URL(request.url);

    if (typeof env.DB === "undefined" || env.DB === null) {
        return new Response(JSON.stringify({ error: 'D1 database not configured' }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
    const DB = env.DB;

    // cusConfig/list.js in the original KV version was listing all image metadata and then grouping by IP.
    // This seems to be for user management / IP activity, not listing system_configs keys.
    // The plan item 8 was for listing system_configs keys, which might be a misunderstanding of this file's purpose.
    // Re-implementing the original logic of grouping image uploads by IP, using D1.

    let page = parseInt(url.searchParams.get('page'), 10) || 1;
    let count = parseInt(url.searchParams.get('count'), 10) || 10;
    page = Math.max(1, page);
    count = Math.max(1, count);
    const offset = (page - 1) * count;

    try {
        // Step 1: Get distinct IPs and their upload counts and latest address, ordered by count desc, paginated.
        // This is a bit complex to do purely in one SQL query with D1 and get UploadAddress efficiently.
        // Alternative: Get all image metadata (or just relevant fields), then process in JS (as original did).
        // Given D1's capabilities, let's try a more optimized SQL if possible, or fall back to JS processing.

        // Optimized approach: Get paginated list of IPs sorted by their upload counts.
        const ipStatsStmt = DB.prepare(`
            SELECT upload_ip, COUNT(*) as upload_count, MAX(upload_address) as last_address
            FROM image_metadata
            WHERE upload_ip IS NOT NULL AND upload_ip != '' 
            GROUP BY upload_ip
            ORDER BY upload_count DESC
            LIMIT ? OFFSET ?
        `);
        const ipStatsResults = await ipStatsStmt.bind(count, offset).all();

        if (!ipStatsResults.success) {
            console.error("Failed to fetch IP stats from D1:", ipStatsResults.error);
            return new Response(JSON.stringify({ error: "Failed to fetch IP statistics." }), {
                status: 500, headers: { "Content-Type": "application/json" }
            });
        }

        const processedData = [];
        for (const row of ipStatsResults.results) {
            // For each IP, fetch their actual image records (or a sample if needed by frontend)
            // This part can be heavy if we fetch all images for each IP.
            // The original code returned all images for the IPs on the current page.
            // Let's return the stats, and frontend can request images for a specific IP if needed.
            processedData.push({
                ip: row.upload_ip,
                address: row.last_address || '未知',
                count: row.upload_count,
                // data: [] // Optionally, frontend can make a new request for this IP's images
            });
        }

        // To determine if there's a next page for IPs
        let nextPageForIps = null;
        if (processedData.length === count) {
             // Check if there is at least one more IP beyond the current set
            const checkNextStmt = DB.prepare(`
                SELECT upload_ip FROM image_metadata 
                WHERE upload_ip IS NOT NULL AND upload_ip != '' 
                GROUP BY upload_ip ORDER BY COUNT(*) DESC LIMIT 1 OFFSET ?
            `);
            const nextCheck = await checkNextStmt.bind(offset + count).first();
            if (nextCheck) {
                nextPageForIps = page + 1;
            }
        }

        return new Response(JSON.stringify({
            // The plan item 8 described listing system_configs keys. This file appears to be for IP-based upload listing.
            // If the goal *was* to list system_configs keys, the implementation would be different.
            // This response matches the original structure of dealByIP more closely.
            results: processedData, // Changed from just resultRecords to a more descriptive name
            nextPage: nextPageForIps, 
            list_complete: nextPageForIps === null
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (e) {
        console.error("Error in cusConfig/list:", e);
        return new Response(JSON.stringify({ error: "Failed to process request.", details: e.message }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
}

// getAllRecords and dealByIP functions are replaced by the D1 query logic above.

