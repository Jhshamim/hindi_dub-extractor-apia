import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PROXY_URL = "https://extract-m3u8-proxy.jahinalamshamim.workers.dev/proxy?url=";

app.get("/api/extract", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing or invalid url parameter" });
    }

    const urlObj = new URL(url);
    const domain = urlObj.origin;
    const videoIdMatch = url.match(/\/video\/([a-zA-Z0-9]+)/);
    if (!videoIdMatch) {
      return res.status(400).json({ error: "Invalid video URL format" });
    }
    const videoId = videoIdMatch[1];

    const postUrl = `${domain}/player/index.php?data=${videoId}&do=getVideo`;
    const postData = `hash=${videoId}&r=${encodeURIComponent(url)}`;
    
    const response = await axios.post(postUrl, postData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": url
      }
    });

    const data = response.data;
    if (!data || !data.videoSource) {
      return res.status(500).json({ error: "Failed to get video source" });
    }

    const masterM3u8Url = data.videoSource;
    const m3u8Res = await axios.get(masterM3u8Url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Referer": domain + "/"
      }
    });

    const m3u8Content = m3u8Res.data;
    
    // Extract available languages and their URLs
    const languages: string[] = [];
    const audioUrls: Record<string, string> = {};
    let highestVideoUrl = "";
    
    const lines = m3u8Content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
        const langMatch = line.match(/LANGUAGE="([^"]+)"/);
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (langMatch && uriMatch) {
          languages.push(langMatch[1]);
          const absoluteUri = uriMatch[1].startsWith('http') ? uriMatch[1] : `${domain}${uriMatch[1]}`;
          audioUrls[langMatch[1]] = `${PROXY_URL}${absoluteUri}`;
        }
      } else if (line.startsWith('#EXT-X-STREAM-INF')) {
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const absoluteUri = nextLine.startsWith('http') ? nextLine : `${domain}${nextLine}`;
          highestVideoUrl = `${PROXY_URL}${absoluteUri}`;
        }
      }
    }

    const host = req.get('host');
    const protocol = req.protocol || 'http';
    // Use APP_URL if available (for AI Studio environment), otherwise use the request host
    // For Vercel, req.get('host') will be the vercel domain
    const appUrl = process.env.APP_URL || `${protocol}://${host}`;

    const files: Record<string, any> = {};
    for (const lang of languages) {
      files[lang] = {
        m3u8_url: `${appUrl}/cache/${videoId}/${lang}_master.m3u8`,
        video_file_url: highestVideoUrl,
        audio_file_url: audioUrls[lang],
        language: lang
      };
    }

    res.json({
      success: true,
      cached: false,
      video_id: videoId,
      video_page: url,
      extracted_domain: domain,
      available_categories: languages,
      files: files,
      note: "Extracted successfully"
    });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/cache/:videoId/:filename", async (req, res) => {
  try {
    const { videoId, filename } = req.params;
    const queryDomain = req.query.domain as string;
    
    const langMatch = filename.match(/^([a-z]+)_master\.m3u8$/);
    if (!langMatch) {
      return res.status(400).send("Invalid filename");
    }
    const targetLang = langMatch[1];

    // Defaulting to the primary domain since we removed the query parameter.
    // If multiple domains are used in the future, we may need to pass this via the URL path.
    const domain = queryDomain || "https://as-cdn21.top";

    const postUrl = `${domain}/player/index.php?data=${videoId}&do=getVideo`;
    const postData = `hash=${videoId}&r=${encodeURIComponent(domain + "/video/" + videoId)}`;
    
    const response = await axios.post(postUrl, postData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": domain + "/video/" + videoId
      }
    });

    const data = response.data;
    if (!data || !data.videoSource) {
      return res.status(500).send("Failed to get video source");
    }

    const masterM3u8Url = data.videoSource;
    const m3u8Res = await axios.get(masterM3u8Url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Referer": domain + "/"
      }
    });

    const m3u8Content = m3u8Res.data;
    const lines = m3u8Content.split('\n');
    const newLines: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        newLines.push("");
        i++;
        continue;
      }

      if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
        const langMatch = line.match(/LANGUAGE="([^"]+)"/);
        if (langMatch && langMatch[1] === targetLang) {
          // Modify URI
          const uriMatch = line.match(/URI="([^"]+)"/);
          if (uriMatch) {
            const originalUri = uriMatch[1];
            const absoluteUri = originalUri.startsWith('http') ? originalUri : `${domain}${originalUri}`;
            const proxiedUri = `${PROXY_URL}${absoluteUri}`;
            
            let newLine = line.replace(`URI="${originalUri}"`, `URI="${proxiedUri}"`);
            newLine = newLine.replace(/DEFAULT=[A-Z]+/, 'DEFAULT=YES');
            newLines.push(newLine);
          } else {
            newLines.push(line);
          }
        }
        // Skip other audio tracks
      } else if (line.startsWith('#EXT-X-STREAM-INF')) {
        newLines.push(line);
        i++;
        const uriLine = lines[i].trim();
        const absoluteUri = uriLine.startsWith('http') ? uriLine : `${domain}${uriLine}`;
        const proxiedUri = `${PROXY_URL}${absoluteUri}`;
        newLines.push(proxiedUri);
      } else {
        newLines.push(line);
      }
      i++;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(newLines.join('\n'));

  } catch (error: any) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

export default app;
