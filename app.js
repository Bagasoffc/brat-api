require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('common'));

// Buat browser instance
let browser;

const launchBrowser = async () => {
  browser = await chromium.launch(); // Browser headless
}

launchBrowser();

async function fetchCount() {
  try {
    return (await axios.get("https://api.counterapi.dev/v1/deline/brat/up")).data?.count || 0
  } catch {
    return 0
  }
}

// ============================
//      ROUTE BRAT VIDEO
// ============================

app.get('/brat-video', async (req, res) => {
  const text = req.query.text;
  const delay = 500; // 0.5 detik per kata

  if (!text) {
    return res.status(400).json({
      status: false,
      message: 'Parameter `text` wajib'
    });
  }

  if (!browser) {
    await launchBrowser();
  }

  const videosDir = path.join(__dirname, 'videos');
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1536, height: 695 },
    recordVideo: {
      dir: videosDir,
      size: { width: 500, height: 500 }
    }
  });

  const page = await context.newPage();
  const filePath = path.join(__dirname, './site/index.html');

  await page.goto(`file://${filePath}`);

  // Sama seperti brat biasa: toggle putih & fokus input
  await page.click('#toggleButtonWhite').catch(() => {});
  await page.click('#textOverlay').catch(() => {});
  await page.click('#textInput').catch(() => {});

  // Animasi: isi input PER KATA, 0.5 detik sekali
  await page.evaluate(async ({ text, delay }) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const input = document.querySelector('#textInput');
    if (!input) return;

    input.value = '';
    const event = new Event('input', { bubbles: true });
    input.dispatchEvent(event);

    const words = text.split(' ');
    let current = '';

    for (let i = 0; i < words.length; i++) {
      current += (i === 0 ? words[i] : ' ' + words[i]);
      input.value = current;
      const ev = new Event('input', { bubbles: true });
      input.dispatchEvent(ev);
      await sleep(delay);
    }
  }, { text, delay });

  await page.waitForTimeout(800);

  await page.close();
  await context.close();

  // Ambil video terbaru dari folder videos
  const folders = fs.readdirSync(videosDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  if (!folders.length) {
    return res.status(500).json({
      status: false,
      message: 'Folder video tidak ditemukan'
    });
  }

  const latestFolder = folders.sort((a, b) =>
    fs.statSync(path.join(videosDir, b.name)).mtimeMs -
    fs.statSync(path.join(videosDir, a.name)).mtimeMs
  )[0];

  const folderPath = path.join(videosDir, latestFolder.name);
  const files = fs.readdirSync(folderPath);
  const videoFile = files.find(f => f.endsWith('.webm'));

  if (!videoFile) {
    return res.status(500).json({
      status: false,
      message: 'File video tidak ditemukan'
    });
  }

  const videoPath = path.join(folderPath, videoFile);

  res.setHeader('Content-Type', 'video/webm');
  const stream = fs.createReadStream(videoPath);
  stream.pipe(res);

  stream.on('close', () => {
    fs.unlink(videoPath, () => {});
    fs.rmdir(folderPath, () => {});
  });
});

// ============================
//      ROUTE BRAT BIASA
// ============================

app.use('*', async (req, res) => {
  const text = req.query.text
  const background = req.query.background
  const color = req.query.color
  const hit = fetchCount()
  if (!text) return res.status(200).json({
    owner: 'agas',
    repository: {
      github: 'https://github.com/Bagasoffc/brat-api/'
    },
    hit: await hit,
    message: "Parameter `text` diperlukan",
    runtime: {
      os: os.type(),
      platform: os.platform(),
      architecture: os.arch(),
      cpuCount: os.cpus().length,
      uptime: `${os.uptime()} seconds`,
      memoryUsage: `${Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)} MB used of ${Math.round(os.totalmem() / 1024 / 1024)} MB`
    }
  })
  if (!browser) {
    await launchBrowser();
  }
  const context = await browser.newContext({
    viewport: {
      width: 1536,
      height: 695
    }
  });
  const page = await context.newPage();

  const filePath = path.join(__dirname, './site/index.html');

  // Open https://www.bratgenerator.com/
  await page.goto(`file://${filePath}`);

  // Click on <div> #toggleButtonWhite
  await page.click('#toggleButtonWhite');

  // Click on <div> #textOverlay
  await page.click('#textOverlay');

  // Click on <input> #textInput
  await page.click('#textInput');

  // Fill "sas" on <input> #textInput
  await page.fill('#textInput', text);

  await page.evaluate((data) => {
    if (data.background) {
      $('.node__content.clearfix').css('background-color', data.background);
    }
    if (data.color) {
      $('.textFitted').css('color', data.color);
    }
  }, { background, color });

  const element = await page.$('#textOverlay');
  const box = await element.boundingBox();

  res.set('Content-Type', 'image/png');
  res.end(await page.screenshot({
    clip: {
      x: box.x,
      y: box.y,
      width: 500,
      height: 500
    }
  }));
  await context.close();
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Menangani penutupan server
const closeBrowser = async () => {
  if (browser) {
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed');
  }
};

process.on('SIGINT', async () => {
  console.log('SIGINT received');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received');
  await closeBrowser();
  process.exit(0);
});

process.on('exit', async () => {
  console.log('Process exiting');
  await closeBrowser();
});
