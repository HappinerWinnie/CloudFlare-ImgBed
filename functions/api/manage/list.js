export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (typeof env.DB === "undefined" || env.DB === null) {
        return new Response('Error: Please configure D1 database', { status: 500 });
    }
    const DB = env.DB;

    let page = parseInt(url.searchParams.get('page'), 10) || 1;
    let count = parseInt(url.searchParams.get('count'), 10);
    if (isNaN(count) || count === -1) { // Handle count=-1 as fetch all for files, directories still paginated or handled differently
        count = Infinity; // Placeholder for fetching all, D1 doesn't support Infinity directly for LIMIT
    } else if (count <= 0) {
        count = 50; // Default count if invalid positive number
    }

    let sumOnly = url.searchParams.get('sum') === 'true';
    let requestedDir = url.searchParams.get('dir') || ''; 

    requestedDir = requestedDir.replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (requestedDir === 'root') requestedDir = '';

    try {
        let files = [];
        let directories = new Set();
        let totalFilesCount = 0;

        // Count total files in the directory if sumOnly is true
        if (sumOnly) {
            let countQuery;
            let countBindings;
            if (requestedDir === '') { // Root directory
                countQuery = DB.prepare(`SELECT COUNT(*) as total FROM image_metadata WHERE folder_path = 'root' OR folder_path = ''`);
                countBindings = [];
            } else { // Specific directory
                countQuery = DB.prepare(`SELECT COUNT(*) as total FROM image_metadata WHERE folder_path = ?`);
                countBindings = [requestedDir];
            }
            const countResult = await countQuery.bind(...countBindings).first();
            totalFilesCount = countResult ? countResult.total : 0;
            return new Response(JSON.stringify({ sum: totalFilesCount }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // Fetch files for the current directory
        const offset = (page - 1) * (isFinite(count) ? count : 0);
        let filesQueryStr;
        let filesBindings;

        if (requestedDir === '') { // Root directory
            filesQueryStr = `SELECT id, file_name, file_type, file_size_mb, timestamp, folder_path, list_type 
                           FROM image_metadata 
                           WHERE folder_path = 'root' OR folder_path = '' 
                           ORDER BY timestamp DESC`;
            filesBindings = [];
        } else { // Specific directory
            filesQueryStr = `SELECT id, file_name, file_type, file_size_mb, timestamp, folder_path, list_type 
                           FROM image_metadata 
                           WHERE folder_path = ? 
                           ORDER BY timestamp DESC`;
            filesBindings = [requestedDir];
        }
        if (isFinite(count)) {
            filesQueryStr += ` LIMIT ? OFFSET ?`;
            filesBindings.push(count, offset);
        }
        
        const filesStmt = DB.prepare(filesQueryStr);
        const fileResults = await filesStmt.bind(...filesBindings).all();

        files = fileResults.results.map(row => ({
            name: row.id, 
            path: row.folder_path,
            type: row.file_type,
            size: row.file_size_mb,
            time: row.timestamp,
            listType: row.list_type,
            // Reconstruct metadata structure if needed by frontend, or adapt frontend
            metadata: { // Basic metadata structure
                FileName: row.file_name,
                FileType: row.file_type,
                FileSize: row.file_size_mb,
                TimeStamp: row.timestamp,
                Folder: row.folder_path,
                ListType: row.list_type
            }
        }));

        // Fetch subdirectories
        let subDirQueryStr;
        let subDirBindings;
        if (requestedDir === '') { // Subdirectories in root
            subDirQueryStr = `SELECT DISTINCT SUBSTR(folder_path, 1, INSTR(folder_path || '/', '/') -1) as dir_name 
                            FROM image_metadata 
                            WHERE folder_path != '' AND folder_path != 'root' AND INSTR(folder_path, '/') > 0`;
            // The above query gets top-level folder names. Example: 'foo' from 'foo/bar' or 'foo'
            // Simpler: get all distinct folder_paths and parse them
             subDirQueryStr = `SELECT DISTINCT folder_path FROM image_metadata WHERE folder_path != '' AND folder_path != 'root'`;
             const allPathsResult = await DB.prepare(subDirQueryStr).all();
             allPathsResult.results.forEach(row => {
                if (row.folder_path) {
                    const firstPart = row.folder_path.split('/')[0];
                    if (firstPart) directories.add(firstPart);
                }
             });

        } else { // Subdirectories in a specific directory
            const prefix = requestedDir + '/';
            subDirQueryStr = `SELECT DISTINCT folder_path 
                            FROM image_metadata 
                            WHERE folder_path LIKE ? AND folder_path != ?`;
            subDirBindings = [`${prefix}%`, requestedDir];
            const subDirResults = await DB.prepare(subDirQueryStr).bind(...subDirBindings).all();
            subDirResults.results.forEach(row => {
                if (row.folder_path.startsWith(prefix)) {
                    const remainingPath = row.folder_path.substring(prefix.length);
                    const subDirName = remainingPath.split('/')[0];
                    if (subDirName) directories.add(prefix + subDirName);
                }
            });
        }
        
        // Pagination info for files (if count was finite)
        let nextPage = null;
        if (isFinite(count) && files.length === count) {
            nextPage = page + 1;
        }

        return new Response(JSON.stringify({
            files: files,
            directories: Array.from(directories),
            nextPage: nextPage, // For file pagination
            list_complete: nextPage === null // Indicates if more files might be available
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (e) {
        console.error("Error listing files/directories from D1:", e);
        return new Response(JSON.stringify({ error: "Failed to list items.", details: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

// getAllRecords function is no longer needed.
