import fetch from 'node-fetch';

export async function fetchPrayerTimes(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();
        return parsePrayerTimes(html);
    } catch (error) {
        logError(error, "Namaz vakitlerini çekerken hata oluştu.");
        return [];
    }
}

function parsePrayerTimes(html) {
    const regex = /<div\s+class="tpt-cell"\s+data-vakit-name="(?:imsak|gunes|ogle|ikindi|aksam|yatsi)".*?<div\s+class="tpt-time">(\d{2}:\d{2})<\/div>/gs;
    let match;
    let times = [];

    while ((match = regex.exec(html)) !== null) {
        times.push(match[1]);
    }

    log(`Çekilen namaz vakitleri: ${times}`);
    return times;
}
