import { fetchOthersConfig } from "./utils/sysConfig";

let othersConfig = {};
let allowRandom = false;

export async function onRequest(context) {
    const {
      request,
      env,
      // params, // Not used
      // waitUntil, // Not used
      // next, // Not used
      // data, // Not used
    } = context;
    const requestUrl = new URL(request.url);

    othersConfig = await fetchOthersConfig(env);
    allowRandom = othersConfig.randomImageAPI.enabled;
    const allowedDirConfig = othersConfig.randomImageAPI.allowedDir;

    if (allowRandom !== true) {
        return new Response(JSON.stringify({ error: "Random is disabled" }), { status: 403 });
    }

    // 检查是否配置了D1数据库
    if (typeof env.DB === "undefined" || env.DB === null) {
        return new Response('Error: Please configure D1 database', { status: 500 });
    }
    const DB = env.DB;

    const allowedDirListFormatted = (allowedDirConfig || '').split(',').map(item => {
        return item.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    }).filter(item => item !== ''); // Filter out empty strings after trim

    const paramContentType = requestUrl.searchParams.get('content');
    const contentTypesFilter = paramContentType ? paramContentType.split(',') : ['image'];

    const paramDir = requestUrl.searchParams.get('dir') || '';
    const requestedDir = paramDir.replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');

    let dirIsAllowed = false;
    if (allowedDirListFormatted.length === 0 || allowedDirListFormatted.includes('')) { // Allow all if empty or contains empty string (effectively allow root and all subdirs)
        dirIsAllowed = true;
    } else {
        for (let allowedDir of allowedDirListFormatted) {
            if (requestedDir === allowedDir || requestedDir.startsWith(allowedDir + '/')) {
                dirIsAllowed = true;
                break;
            }
        }
    }

    if (!dirIsAllowed) {
        return new Response(JSON.stringify({ error: "Directory not allowed" }), { status: 403 });
    }

    let query = 'SELECT id, file_type FROM image_metadata';
    const bindings = [];
    const conditions = [];

    if (requestedDir && requestedDir !== 'root') {
        conditions.push('(folder_path = ? OR folder_path LIKE ?)');
        bindings.push(requestedDir, `${requestedDir}/%`);
    } else if (requestedDir === 'root') {
        conditions.push("(folder_path = 'root' OR folder_path = '')");
    }
    // If requestedDir is empty, no folder_path condition, selects from all.

    const typeConditions = [];
    contentTypesFilter.forEach(ct => {
        if (ct.toLowerCase() === 'image') {
            typeConditions.push("file_type LIKE 'image/%'");
        } else if (ct.toLowerCase() === 'video') {
            typeConditions.push("file_type LIKE 'video/%'");
        }
        // Add other content types if necessary
    });

    if (typeConditions.length > 0) {
        conditions.push(`(${typeConditions.join(' OR ')})`);
    }
    
    // Ensure list_type is not 'Block' or 'adult'
    conditions.push("(list_type IS NULL OR (list_type != 'Block' AND list_type != 'adult'))");


    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY RANDOM() LIMIT 1;';
    
    const stmt = DB.prepare(query);
    const randomImageRecord = await stmt.bind(...bindings).first();

    if (!randomImageRecord) {
        return new Response(JSON.stringify({ error: "No image found matching criteria" }), { status: 404 });
    }

    const fileId = randomImageRecord.id;
    const fileTypeHeader = randomImageRecord.file_type;
    const randomPath = '/file/' + fileId;
    let randomUrl = randomPath;

    const responseType = requestUrl.searchParams.get('type');
    const responseFormat = requestUrl.searchParams.get('form');
    
    if (responseType === 'url') {
        randomUrl = requestUrl.origin + randomPath;
    }

    if (responseType === 'img') {
        randomUrl = requestUrl.origin + randomPath;
        // Fetching the actual image to return as blob
        try {
            const imageResponse = await fetch(randomUrl);
            if (!imageResponse.ok) {
                 return new Response('Failed to fetch the image file', { status: imageResponse.status });
            }
            const imageBlob = await imageResponse.blob();
            const headers = { 'Content-Type': imageBlob.type || fileTypeHeader || 'application/octet-stream' };
            return new Response(imageBlob, { headers, status: 200 });
        } catch (e) {
            console.error("Error fetching image for /random endpoint:", e);
            return new Response('Error fetching image file', { status: 500 });
        }
    }
    
    if (responseFormat === 'text') {
        return new Response(randomUrl, { status: 200, headers: {'Content-Type': 'text/plain'} });
    } else {
        return new Response(JSON.stringify({ url: randomUrl }), { status: 200, headers: {'Content-Type': 'application/json'} });
    }
}

// getRandomFileList function is no longer needed as logic is integrated above.
// If caching was intended for the list from D1, it would need a different approach.
// For a single random item, caching the query result itself isn't typical.