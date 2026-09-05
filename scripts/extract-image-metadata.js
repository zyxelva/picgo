const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

// ============ 配置 ============
const IMAGE_DIR = 'source/images/Footprint';  // 图片存放目录
const OUTPUT_JSON = 'source/data/footprints.json';  // 输出 JSON 路径
const DEFAULT_COORDS = { latitude: 23.1291, longitude: 113.2644 };  // 默认广州坐标[reference:2]
const CDN_BASE = 'https://gcore.jsdelivr.net/gh/zyxelva/picgo/images/Footprint/';
const DEFAULT_URL_LABEL = '游记';

// 支持的文件扩展名
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.tiff', '.bmp', '.webp']);

// ============ 工具函数 ============

/** 判断文件是否为图片 */
function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

/** 从文件名生成名称（去掉扩展名和序号后缀） */
function generateName(filename) {
    let name = path.basename(filename, path.extname(filename));
    // 移除常见序号后缀：_1, -2, (3) 等
    name = name.replace(/[_\-\s]*(?:\(\d+\)|-\d+|_\d+|\d+)$/, '').trim();
    // 如果名称过短或为空，使用默认名
    if (!name || name.length < 1) return '未命名地点';
    return name;
}

/** 格式化日期：只保留年份（如 "2017"）或完整日期 */
function formatDate(dateObj) {
    if (!dateObj) return '';
    try {
        const d = new Date(dateObj);
        if (isNaN(d.getTime())) return '';
        // 如果只有年份信息，返回年份
        const year = d.getFullYear();
        return String(year);
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
    // 如果图片路径已经是完整 URL，直接返回
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        return filename;
    }
    // 否则拼接 CDN 基础路径
    const baseName = path.basename(filename);
    return CDN_BASE + baseName;
}

// ============ 核心处理函数 ============

/**
 * 处理单张图片，提取元数据
 */
async function processImage(filePath) {
    const filename = path.basename(filePath);

    try {
        // 使用 exifr 提取 GPS 和日期信息
        // gps: true 只提取 GPS 坐标[reference:3]
        const metadata = await exifr.parse(filePath, {
            gps: true,
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
                'DateTimeOriginal', 'CreateDate', 'Model', 'Make']
        });

        // 提取 GPS 坐标
        let latitude = null;
        let longitude = null;

        if (metadata) {
            // exifr 可能直接提供 latitude/longitude
            if (metadata.latitude !== undefined && metadata.longitude !== undefined) {
                latitude = metadata.latitude;
                longitude = metadata.longitude;
            }
            // 或者通过 GPS 标签提取
            else if (metadata.GPSLatitude && metadata.GPSLongitude) {
                latitude = convertGpsToDecimal(metadata.GPSLatitudeRef, metadata.GPSLatitude);
                longitude = convertGpsToDecimal(metadata.GPSLongitudeRef, metadata.GPSLongitude);
            }
        }

        // 如果没有坐标信息，使用默认坐标（广州）
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

        // 生成名称
        const name = generateName(filename);

        // 构建 location 对象
        return {
            name: name,
            coordinates: `${finalLng.toFixed(4)},${finalLat.toFixed(4)}`,
            date: date || '',
            url: '',
            urlLabel: DEFAULT_URL_LABEL,
            categories: ['去过'],
            markerColor: 'ocean',
            photos: [getCdnUrl(filename)]
        };

    } catch (error) {
        console.error(`处理图片失败: ${filePath}`, error.message);
        // 即使失败，也返回一个默认条目，确保不会丢失数据
        return {
            name: generateName(filename),
            coordinates: `${DEFAULT_COORDS.longitude.toFixed(4)},${DEFAULT_COORDS.latitude.toFixed(4)}`,
            date: '',
            url: '',
            urlLabel: DEFAULT_URL_LABEL,
            categories: ['去过'],
            markerColor: 'ocean',
            photos: [getCdnUrl(filename)]
        };
    }
}

/**
 * 扫描目录，批量处理所有图片
 */
async function scanDirectory(dirPath) {
    const results = [];

    if (!fs.existsSync(dirPath)) {
        console.warn(`目录不存在: ${dirPath}`);
        return results;
    }

    const files = fs.readdirSync(dirPath);
    const imageFiles = files.filter(f => isImageFile(f));

    console.log(`找到 ${imageFiles.length} 张图片`);

    // 逐个处理图片
    for (const file of imageFiles) {
        const fullPath = path.join(dirPath, file);
        console.log(`处理: ${file}`);
        const result = await processImage(fullPath);
        results.push(result);
    }

    return results;
}

// ============ 主函数 ============

async function main() {
    console.log('开始提取图片元数据...');
    console.log(`图片目录: ${IMAGE_DIR}`);
    console.log(`输出文件: ${OUTPUT_JSON}`);

    // 扫描并处理所有图片
    const locations = await scanDirectory(IMAGE_DIR);

    // 按名称排序（可选）
    locations.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    // 构建最终 JSON
    const output = { locations };

    // 确保输出目录存在
    const outputDir = path.dirname(OUTPUT_JSON);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 写入 JSON 文件
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`✅ 成功生成 ${locations.length} 条足迹数据`);
    console.log(`📁 输出文件: ${OUTPUT_JSON}`);
}

// 运行
main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
});