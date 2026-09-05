const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const axios = require('axios'); // 新增

// ============ 配置 ============
const IMAGE_DIR = './images/Footprint';
const OUTPUT_JSON = './data/footprints.json';
const DEFAULT_COORDS = { latitude: 23.1291, longitude: 113.2644 };
const CDN_BASE = 'https://gcore.jsdelivr.net/gh/zyxelva/picgo/images/Footprint/';
const DEFAULT_URL_LABEL = '游记';

// 支持的文件扩展名
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.tiff', '.bmp', '.webp']);

// markerColor 预设值（从你上传的图片中提取）
const MARKER_COLORS = ['sunset', 'ocean', 'violet', 'forest', 'amber', 'citrus'];

// ============ 工具函数 ============

/** 判断文件是否为图片 */
function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

/** 从文件名生成名称（去掉扩展名和序号后缀）—— 作为 fallback */
function generateName(filename) {
    let name = path.basename(filename, path.extname(filename));
    name = name.replace(/[_\-\s]*(?:\(\d+\)|-\d+|_\d+|\d+)$/, '').trim();
    if (!name || name.length < 1) return '未命名地点';
    return name;
}

/** 格式化日期：只保留年份 */
function formatDate(dateObj) {
    if (!dateObj) return '';
    try {
        const d = new Date(dateObj);
        if (isNaN(d.getTime())) return '';
        return String(d.getFullYear());
    } catch {
        return '';
    }
}

/** 将 EXIF 的 GPS 坐标转换为十进制度数 */
function convertGpsToDecimal(gpsRef, gpsArray) {
    if (!gpsArray || gpsArray.length < 3) return null;
    const [deg, min, sec] = gpsArray.map(v => {
        if (typeof v === 'number') return v;
        if (Array.isArray(v) && v.length === 2) return v[0] / v[1];
        return 0;
    });
    let decimal = deg + min / 60 + sec / 3600;
    if (gpsRef === 'S' || gpsRef === 'W') decimal = -decimal;
    return decimal;
}

/** 从图片路径生成 CDN URL */
function getCdnUrl(filename) {
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        return filename;
    }
    const baseName = path.basename(filename);
    return CDN_BASE + baseName;
}

/** 随机选择一个 markerColor */
function getRandomMarkerColor() {
    return MARKER_COLORS[Math.floor(Math.random() * MARKER_COLORS.length)];
}

// ============ 反向地理编码（高德 API） ============

/**
 * 调用高德逆地理编码 API，获取中文地名
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {string} apiKey - 高德 Web 服务 API Key
 * @returns {Promise<string>} 返回地点名称（如 "天安门广场"）
 */
async function getLocationName(lat, lng, apiKey) {
    if (!apiKey) {
        console.warn('⚠️ 未提供高德 API Key，跳过地名获取。');
        return null;
    }

    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${apiKey}&location=${lng},${lat}&extensions=base`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === '1' && data.regeocode) {
            const addr = data.regeocode.addressComponent;
            // 优先返回乡镇/街道，其次区/县，最后格式化地址
            if (addr.township) return addr.township;
            if (addr.district) return addr.district;
            return data.regeocode.formatted_address || null;
        } else {
            console.warn(`⚠️ 高德 API 返回错误 (${lng}, ${lat}): ${data.info}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ 调用高德 API 失败 (${lng}, ${lat}):`, error.message);
        return null;
    }
}

// ============ 核心处理函数 ============

/**
 * 处理单张图片，提取元数据
 */
async function processImage(filePath, amapKey) {
    const filename = path.basename(filePath);

    try {
        const metadata = await exifr.parse(filePath, {
            gps: true,
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
                'DateTimeOriginal', 'CreateDate', 'Model', 'Make']
        });

        // 提取 GPS 坐标
        let latitude = null;
        let longitude = null;

        if (metadata) {
            if (metadata.latitude !== undefined && metadata.longitude !== undefined) {
                latitude = metadata.latitude;
                longitude = metadata.longitude;
            } else if (metadata.GPSLatitude && metadata.GPSLongitude) {
                latitude = convertGpsToDecimal(metadata.GPSLatitudeRef, metadata.GPSLatitude);
                longitude = convertGpsToDecimal(metadata.GPSLongitudeRef, metadata.GPSLongitude);
            }
        }

        const hasCoords = (latitude !== null && longitude !== null &&
            !isNaN(latitude) && !isNaN(longitude) &&
            latitude !== 0 && longitude !== 0);

        const finalLat = hasCoords ? latitude : DEFAULT_COORDS.latitude;
        const finalLng = hasCoords ? longitude : DEFAULT_COORDS.longitude;

        // 提取拍摄日期
        let date = '';
        if (metadata) {
            const dateStr = metadata.DateTimeOriginal || metadata.CreateDate || '';
            if (dateStr) {
                const parsed = formatDate(dateStr);
                if (parsed) date = parsed;
            }
        }

        // ----- 获取地点名称（优先使用高德逆地理编码）-----
        let locationName = null;
        if (hasCoords && amapKey) {
            locationName = await getLocationName(finalLat, finalLng, amapKey);
        }
        // 如果获取失败或没有坐标，使用文件名作为名称
        if (!locationName) {
            locationName = generateName(filename);
        }

        // 随机选择 markerColor
        const markerColor = getRandomMarkerColor();

        // 构建 location 对象
        return {
            name: locationName,
            coordinates: `${finalLng.toFixed(4)},${finalLat.toFixed(4)}`,
            date: date || '',
            url: '',
            urlLabel: DEFAULT_URL_LABEL,
            categories: ['去过'],
            markerColor: markerColor,
            photos: [getCdnUrl(filename)]
        };

    } catch (error) {
        console.error(`处理图片失败: ${filePath}`, error.message);
        // 失败时返回基础数据
        return {
            name: generateName(filename),
            coordinates: `${DEFAULT_COORDS.longitude.toFixed(4)},${DEFAULT_COORDS.latitude.toFixed(4)}`,
            date: '',
            url: '',
            urlLabel: DEFAULT_URL_LABEL,
            categories: ['去过'],
            markerColor: getRandomMarkerColor(),
            photos: [getCdnUrl(filename)]
        };
    }
}

/**
 * 扫描目录，批量处理所有图片
 */
async function scanDirectory(dirPath, amapKey) {
    const results = [];

    if (!fs.existsSync(dirPath)) {
        console.warn(`目录不存在: ${dirPath}`);
        return results;
    }

    const files = fs.readdirSync(dirPath);
    const imageFiles = files.filter(f => isImageFile(f));

    console.log(`找到 ${imageFiles.length} 张图片`);

    for (const file of imageFiles) {
        const fullPath = path.join(dirPath, file);
        console.log(`处理: ${file}`);
        const result = await processImage(fullPath, amapKey);
        results.push(result);
    }

    return results;
}

// ============ 主函数 ============

async function main() {
    // 从环境变量读取高德 API Key（GitHub Secrets 注入）
    const amapKey = process.env.AMAP_API_KEY || '';

    console.log('开始提取图片元数据...');
    console.log(`图片目录: ${IMAGE_DIR}`);
    console.log(`输出文件: ${OUTPUT_JSON}`);
    if (amapKey) {
        console.log('✅ 已配置高德 API Key，将进行反向地理编码');
    } else {
        console.warn('⚠️ 未设置 AMAP_API_KEY 环境变量，将使用文件名作为地点名称');
    }

    const locations = await scanDirectory(IMAGE_DIR, amapKey);

    // 按名称排序
    locations.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    const output = { locations };

    const outputDir = path.dirname(OUTPUT_JSON);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`✅ 成功生成 ${locations.length} 条足迹数据`);
    console.log(`📁 输出文件: ${OUTPUT_JSON}`);
}

main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
});