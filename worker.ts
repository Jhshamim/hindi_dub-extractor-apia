export interface Env {
  // Add environment variables here if needed
}

const PROXY_URL = "https://extract-m3u8-proxy.jahinalamshamim.workers.dev/proxy?url=";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Setup CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route: /api/extract
      if (url.pathname === "/api/extract") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing or invalid url parameter" }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const urlObj = new URL(targetUrl);
        const domain = urlObj.origin;
        const videoIdMatch = targetUrl.match(/\/video\/([a-zA-Z0-9]+)/);
        if (!videoIdMatch) {
          return new Response(JSON.stringify({ error: "Invalid video URL format" }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }
        const videoId = videoIdMatch[1];

        const postUrl = `${domain}/player/index.php?data=${videoId}&do=getVideo`;
        const postData = new URLSearchParams();
        postData.append("hash", videoId);
        postData.append("r", targetUrl);

        const response = await fetch(postUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": targetUrl
          },
          body: postData.toString()
        });

        const data: any = await response.json();
        if (!data || !data.videoSource) {
          return new Response(JSON.stringify({ error: "Failed to get video source" }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const masterM3u8Url = data.videoSource;
        const m3u8Res = await fetch(masterM3u8Url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Referer": domain + "/"
          }
        });

        const m3u8Content = await m3u8Res.text();
        
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
              audioUrls[langMatch[1]] = absoluteUri;
            }
          } else if (line.startsWith('#EXT-X-STREAM-INF')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && !nextLine.startsWith('#')) {
              const absoluteUri = nextLine.startsWith('http') ? nextLine : `${domain}${nextLine}`;
              highestVideoUrl = absoluteUri;
            }
          }
        }

        const appUrl = `${url.protocol}//${url.host}`;
        const files: Record<string, any> = {};
        for (const lang of languages) {
          files[lang] = {
            m3u8_url: `${appUrl}/cache/${videoId}/${lang}_master.m3u8`,
            video_file_url: highestVideoUrl,
            audio_file_url: audioUrls[lang],
            language: lang
          };
        }

        return new Response(JSON.stringify({
          success: true,
          cached: false,
          video_id: videoId,
          video_page: targetUrl,
          extracted_domain: domain,
          available_categories: languages,
          files: files,
          note: "Extracted successfully"
        }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // Route: /cache/:videoId/:filename
      const cacheMatch = url.pathname.match(/^\/cache\/([a-zA-Z0-9]+)\/([a-z]+)_master\.m3u8$/);
      if (cacheMatch) {
        const videoId = cacheMatch[1];
        const targetLang = cacheMatch[2];
        const queryDomain = url.searchParams.get("domain");
        
        // Defaulting to the primary domain since we removed the query parameter.
        const domain = queryDomain || "https://as-cdn21.top";

        const postUrl = `${domain}/player/index.php?data=${videoId}&do=getVideo`;
        const postData = new URLSearchParams();
        postData.append("hash", videoId);
        postData.append("r", `${domain}/video/${videoId}`);

        const response = await fetch(postUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${domain}/video/${videoId}`
          },
          body: postData.toString()
        });

        const data: any = await response.json();
        if (!data || !data.videoSource) {
          return new Response("Failed to get video source", { status: 500, headers: corsHeaders });
        }

        const masterM3u8Url = data.videoSource;
        const m3u8Res = await fetch(masterM3u8Url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Referer": domain + "/"
          }
        });

        const m3u8Content = await m3u8Res.text();
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

        return new Response(newLines.join('\n'), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/vnd.apple.mpegurl"
          }
        });
      }

      // Fallback for any other route
      return new Response("Not found", { status: 404, headers: corsHeaders });

    } catch (error: any) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }
};
