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

// Browser instance
let browser;

const launchBrowser = async () => {
  browser = await chromium.launch(); 
}

launchBrowser();

async function fetchCount() {
  try {
    return (await axios.get("https://api.counterapi.dev/v1/deline/brat/up")).data?.count || 0
  } catch {
    return 0;
  }
}

// ========================================================
//                BRAT VIDEO — PER KATA
//                Disimpan di RAM (/tmp)
// ========================================================

app.get('/brat-video', async (req, res) => {
  const text = req.query.text;
  const delay = 500; // 0.5 detik per kata

  if (!text) {
    return res.status(400).json({
      status: false,
      message: "Parameter `text` wajib"
    });
  }

  if (!browser) await launchBrowser();

  // Folder RAM (tmpfs)
  const videosDir = "/tmp/brat-videos";
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

  // Buka pengaturan default brat
  await page.click('#toggleButtonWhite').catch(() => {});
  await page.click('#textOverlay').catch(() => {});
  await page.click('#textInput').catch(() => {});

  // ANIMASI PER KATA
  await page.evaluate(async ({ text, delay }) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const input = document.querySelector("#textInput");
    if (!input) return;

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const words = text.split(" ");
    let current = "";

    for (let i = 0; i < words.length; i++) {
      current += (i === 0 ? words[i] : " " + words[i]);
      input.value = current;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(delay);
    }
  }, { text, delay });

  await page.waitForTimeout(800);

  // finalize video
  await page.close();
  await context.close();

  // Ambil file .webm terbaru dari RAM
  const files = fs.readdirSync(videosDir).filter(f => f.endsWith('.webm'));

  if (!files.length) {
    return res.status(500).json({
      status: false,
      message: "File video tidak ditemukan"
    });
  }

  const newest = files.sort((a, b) =>
    fs.statSync(path.join(videosDir, b)).mtimeMs -
    fs.statSync(path.join(videosDir, a)).mtimeMs
  )[0];

  const videoPath = path.join(videosDir, newest);

  res.setHeader("Content-Type", "video/webm");
  const stream = fs.createReadStream(videoPath);
  stream.pipe(res);

  // Hapus video dari RAM setelah dikirim
  stream.on("close", () => {
    fs.unlink(videoPath, () => {});
  });
});

// ========================================================
//                      BRAT GAMBAR BIASA
// ========================================================

app.use('*', async (req, res) => {
  const text = req.query.text;
  const background = req.query.background;
  const color = req.query.color;
  const hit = fetchCount();

  if (!text) {
    return res.status(200).json({
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
  }

  if (!browser) await launchBrowser();

  const context = await browser.newContext({
    viewport: { width: 1536, height: 695 }
  });

  const page = await context.newPage();
  const filePath = path.join(__dirname, './site/index.html');
  await page.goto(`file://${filePath}`);

  await page.click('#toggleButtonWhite');
  await page.click('#textOverlay');
  await page.click('#textInput');
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

  res.set("Content-Type", "image/png");
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

// ========================================================
//                  START SERVER
// ========================================================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Tangani penutupan
const closeBrowser = async () => {
  if (browser) {
    await browser.close();
  }
};

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("exit", async () => {
  await closeBrowser();
});
