const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5174;

app.use(cors());

// Track ongoing requests to prevent duplicates
const ongoingRequests = new Map();

// Simple concurrency limiter: max 5 simultaneous requests
class ConcurrencyLimiter {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.running >= this.limit) {
      // Wait for a slot to become available
      await new Promise(resolve => this.queue.push(resolve));
    }
    
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}

const limit = new ConcurrencyLimiter(5);

// Helper: convert Wayback timestamp (YYYYMMDDHHMMSS) to ISO string
function parseWaybackTimestamp(waybackTs) {
  if (!waybackTs || waybackTs.length !== 14) return null;
  const year = waybackTs.substring(0, 4);
  const month = waybackTs.substring(4, 6);
  const day = waybackTs.substring(6, 8);
  const hour = waybackTs.substring(8, 10);
  const minute = waybackTs.substring(10, 12);
  const second = waybackTs.substring(12, 14);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

// Helper: fetch CDX data with retries
async function fetchCDXData(username, retries = 3) {
  const cdxUrls = [
    `https://web.archive.org/cdx/search/cdx?url=twitter.com/${username}/status/*&output=json&filter=statuscode:200`,
    `https://web.archive.org/cdx/search/cdx?url=twitter.com/${username}/status/*&output=json&filter=statuscode:200&limit=1000`,
    `https://web.archive.org/cdx/search/cdx?url=twitter.com/${username}/status/*&output=json&filter=statuscode:200&limit=500`
  ];

  for (let attempt = 0; attempt < retries; attempt++) {
    for (const cdxUrl of cdxUrls) {
      try {
        console.log(`Attempt ${attempt + 1}: Fetching CDX data from ${cdxUrl}...`);
        const { data } = await axios.get(cdxUrl, { 
          timeout: 15000, // 15 second timeout per attempt
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WaybackBot/1.0)' }
        });
        
        if (Array.isArray(data) && data.length > 1) {
          console.log(`Successfully fetched ${data.length - 1} captures from CDX API`);
          return data;
        }
      } catch (err) {
        console.log(`CDX attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt === retries - 1) throw err;
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  throw new Error('All CDX API attempts failed');
}

// Helper: fetch and extract tweet text/timestamp from a Wayback snapshot
async function extractTweetFromSnapshot(snapshotUrl, waybackTimestamp) {
  try {
    const { data, headers } = await axios.get(snapshotUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 7000, // 7 second timeout per request
    });
    
    // Try JSON first
    if (headers['content-type'] && headers['content-type'].includes('application/json')) {
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      if (json && json.data && json.data.text && json.data.created_at) {
        return {
          text: json.data.text,
          timestamp: json.data.created_at,
        };
      }
    }
    
    // Fallback: HTML parsing
    const $ = cheerio.load(data);
    
    // Try to find tweet text (Twitter classic layout)
    let text = $('meta[property="og:description"]').attr('content') || '';
    if (!text) {
      text = $('div[data-testid="tweetText"]').text();
    }
    if (!text) {
      // Additional selectors for different Twitter layouts
      text = $('.tweet-text').text() || $('.js-tweet-text').text() || $('[data-testid="tweetText"]').text();
    }
    
    // Try to find timestamp from tweet content first
    let timestamp = $('meta[property="article:published_time"]').attr('content') || '';
    if (!timestamp) {
      timestamp = $('time').attr('datetime') || '';
    }
    if (!timestamp) {
      // Additional timestamp selectors
      timestamp = $('.tweet-timestamp').attr('title') || $('.js-tweet-timestamp').attr('title') || '';
    }
    
    // If no tweet timestamp found, use Wayback timestamp as fallback
    if (!timestamp && waybackTimestamp) {
      timestamp = parseWaybackTimestamp(waybackTimestamp);
    }
    
    if (text && timestamp) {
      return { text, timestamp };
    }
  } catch (err) {
    // Skip failed requests silently
    console.log(`Failed to fetch ${snapshotUrl}: ${err.message}`);
  }
  return null;
}

app.get('/api/tweets/:username', async (req, res) => {
  const username = req.params.username.replace(/^@/, '');
  
  // Check if there's already a request in progress for this username
  if (ongoingRequests.has(username)) {
    console.log(`Request already in progress for @${username}, waiting...`);
    try {
      const result = await ongoingRequests.get(username);
      return res.json(result);
    } catch (error) {
      ongoingRequests.delete(username);
      return res.status(500).json({ error: 'Previous request failed' });
    }
  }
  
  // Create a promise for this request
  const requestPromise = (async () => {
    try {
      const data = await fetchCDXData(username);
      
      const headers = data[0];
      const urlIdx = headers.indexOf('original');
      const tsIdx = headers.indexOf('timestamp');
      
      const captures = data.slice(1)
        .filter(row => row[urlIdx] && row[urlIdx].includes('/status/'))
        .map(row => ({
          url: row[urlIdx],
          timestamp: row[tsIdx],
        }));
      
      console.log(`Found ${captures.length} captures for @${username}`);
      
      // Limit to most recent 100 captures for performance
      const recentCaptures = captures.slice(-100);
      
      // Process captures with concurrency control
      const tweetPromises = recentCaptures.map(cap => {
        const snapshotUrl = `https://web.archive.org/web/${cap.timestamp}id_/${cap.url}`;
        return limit.run(() => extractTweetFromSnapshot(snapshotUrl, cap.timestamp));
      });
      
      console.log(`Processing ${recentCaptures.length} snapshots with concurrency control...`);
      const results = await Promise.all(tweetPromises);
      
      // Filter out null results and tweets without text
      const tweets = results
        .filter(tweet => tweet && tweet.text && tweet.timestamp)
        .map(tweet => ({
          text: tweet.text,
          timestamp: tweet.timestamp,
        }));
      
      // Sort newest to oldest
      tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      console.log(`Successfully extracted ${tweets.length} tweets for @${username}`);
      return tweets;
      
    } catch (err) {
      console.error(`Error fetching tweets for @${username}:`, err.message);
      
      // Check if it's a timeout error
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        throw new Error('Request timeout - Wayback Machine is taking too long to respond. Please try again.');
      }
      
      // Check if it's a network error
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        throw new Error('Wayback Machine is currently unavailable. Please try again later.');
      }
      
      throw new Error('Failed to fetch tweets');
    }
  })();
  
  // Store the promise and handle the response
  ongoingRequests.set(username, requestPromise);
  
  try {
    const tweets = await requestPromise;
    res.json(tweets);
  } catch (error) {
    if (error.message.includes('timeout')) {
      res.status(408).json({ error: error.message });
    } else if (error.message.includes('unavailable')) {
      res.status(503).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  } finally {
    ongoingRequests.delete(username);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
