import { getUploadConfig } from '../api/manage/sysConfig/upload';
import { getSecurityConfig } from '../api/manage/sysConfig/security';
import { getPageConfig } from '../api/manage/sysConfig/page';
import { getOthersConfig } from '../api/manage/sysConfig/others';

export async function fetchUploadConfig(env) {
    const DB = env.DB;
    const settings = await getUploadConfig(DB, env);
    // 去除 已禁用 的渠道
    settings.telegram.channels = settings.telegram.channels.filter((channel) => channel.enabled);
    settings.cfr2.channels = settings.cfr2.channels.filter((channel) => channel.enabled);
    settings.s3.channels = settings.s3.channels.filter((channel) => channel.enabled);

    return settings;
}

export async function fetchSecurityConfig(env) {
    const DB = env.DB;
    const settings = await getSecurityConfig(DB, env);
    return settings;
}

export async function fetchPageConfig(env) {
    const DB = env.DB;
    const settings = await getPageConfig(DB, env);
    return settings;
}

export async function fetchOthersConfig(env) {
    const DB = env.DB;
    const settings = await getOthersConfig(DB, env);
    return settings;
}