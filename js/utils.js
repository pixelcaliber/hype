export async function sendLogToServer(level, message, details = {}) {
    const logPayload = {
        level,
        message,
        details,
        timestamp: new Date().toISOString(),
    };
    if (level == 'INFO') {
        console.log(message);
    } else if (level == 'ERROR') {
        console.error(message);
    } else if (level == 'WARN') {
        console.warn(message)
    }

    fetch('http://localhost:3000/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload),
    }).catch((error) => console.error('Failed to send log to server:', error));
}