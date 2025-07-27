// require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

// For local development, fallback to regular puppeteer
let puppeteer;
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  puppeteer = require('puppeteer-core');
} else {
  puppeteer = require('puppeteer-core');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASSWORD
  }
});

// Browser configuration for Lambda vs Local
async function getBrowserConfig() {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // AWS Lambda configuration with @sparticuz/chromium
    return {
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off',
        '--max_old_space_size=4096'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 60000
    };
  } else {
    // Local development configuration
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      timeout: 60000
    };
  }
}

async function createBrowser() {
  const config = await getBrowserConfig();
  console.log('Browser config:', JSON.stringify(config, null, 2));
  return await puppeteer.launch(config);
}

async function safeGotoNewPage(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    let browser;
    let page;
    try {
      browser = await createBrowser();
      page = await browser.newPage();
      
      // Set user agent to avoid bot detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 720 });
      
      // Add extra wait time and error handling
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 45000 
      });
      
      // Wait a bit more for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      
      return { page, browser };
    } catch (e) {
      console.error(`Browser launch/navigation attempt ${i + 1} failed:`, e.message);
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.warn('Error closing browser:', closeError.message);
        }
      }
      if (i === retries - 1) throw e;
      console.warn(`Retrying with new browser (${i + 1}/${retries}) due to:`, e.message);
      await new Promise(res => setTimeout(res, 3000 * (i + 1))); // Longer exponential backoff
    }
  }
}

async function waitAndRetrySelector(page, selector, maxRetries = 10, delayMs = 3000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await page.waitForSelector(selector, { timeout: delayMs });
      return true;
    } catch (e) {
      attempt++;
      console.warn(`Retrying ${selector} (${attempt}/${maxRetries})...`);
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }
  return false;
}

async function inValidUrl(url) {
  try {
    new URL(url);
    const parsed = new URL(url);
    return !(parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch (e) {
    return true;
  }
}

async function fetchLeetCode(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching LeetCode:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const html = await page.content();
    const $ = cheerio.load(html);

    let solved = 0;
    const bodyText = $('body').text();
    const match = bodyText.match(/(\d+)\s*\/\s*\d+\s*Solved/);
    if (match) {
      solved = parseInt(match[1], 10);
    }

    console.log('leetcode', solved);
    return solved;
  } catch (error) {
    console.error('Error fetching LeetCode:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing LeetCode browser:', e.message);
      }
    }
  }
}

async function fetchCodeStudio(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching CodeStudio:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const selector = 'div.data';
    const success = await waitAndRetrySelector(page, selector);
    
    let codingCount = 0;
    if (success) {
      const html = await page.content();
      const $ = cheerio.load(html);

      $('div.data div').each((_, div) => {
        const text = $(div).text().trim();
        const match = text.match(/Coding\s*\((\d+)\)/);
        if (match) {
          codingCount = parseInt(match[1], 10);
          return false;
        }
      });
    }

    console.log('CodeStudio', codingCount);
    return codingCount;
  } catch (error) {
    console.error('Error fetching CodeStudio:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing CodeStudio browser:', e.message);
      }
    }
  }
}

async function fetchGFG(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching GFG:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const selector = '.scoreCard_head__nxXR8';
    const success = await waitAndRetrySelector(page, selector);
    
    let problemSolved = 0;
    if (success) {
      const html = await page.content();
      const $ = cheerio.load(html);

      $('.scoreCard_head__nxXR8').each((_, element) => {
        const label = $(element).find('.scoreCard_head_left--text__KZ2S1').text().trim();
        const score = $(element).find('.scoreCard_head_left--score__oSi_x').text().trim();

        if (label === 'Problem Solved') {
          problemSolved = parseInt(score, 10);
          return false;
        }
      });
    }

    console.log('gfg', problemSolved);
    return problemSolved;
  } catch (error) {
    console.error('Error fetching GFG:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing GFG browser:', e.message);
      }
    }
  }
}

async function fetchInterview(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching InterviewBit:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const selector = '.profile-daily-goal__goal';
    const success = await waitAndRetrySelector(page, selector);
    
    let result = 0;
    if (success) {
      const html = await page.content();
      const $ = cheerio.load(html);

      $('.profile-daily-goal__goal').each((i, el) => {
        const title = $(el).find('.profile-daily-goal__goal-title').text().trim();
        if (title === 'Problems') {
          const detailsDiv = $(el).find('.profile-daily-goal__goal-details');
          const text = detailsDiv
            .clone()
            .children('div.profile-daily-goal__goal-icon')
            .remove()
            .end()
            .text()
            .trim();

          result = parseInt(text, 10);
          return false;
        }
      });
    }

    console.log('interviewbit:', result);
    return result;
  } catch (error) {
    console.error('Error fetching InterviewBit:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing InterviewBit browser:', e.message);
      }
    }
  }
}

async function fetchCodechef(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching CodeChef:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const selector = '.rating-data-section.problems-solved';
    const success = await waitAndRetrySelector(page, selector);
    
    let totalSolved = 0;
    if (success) {
      totalSolved = await page.evaluate(() => {
        const section = document.querySelector('.rating-data-section.problems-solved');
        if (!section) return 0;

        const h3Elements = section.querySelectorAll('h3');
        for (let el of h3Elements) {
          if (el.textContent.includes('Total Problems Solved')) {
            const match = el.textContent.match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
          }
        }
        return 0;
      });
    }

    console.log('codechef', totalSolved);
    return totalSolved;
  } catch (error) {
    console.error('Error fetching CodeChef:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing CodeChef browser:', e.message);
      }
    }
  }
}

async function fetchCodeforces(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching Codeforces:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    let solvedProblems = 0;
    try {
      solvedProblems = await page.$eval('._UserActivityFrame_counterValue', el => {
        const text = el.innerText.trim();
        const match = text.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
      });
    } catch (e) {
      console.warn('Could not find Codeforces counter element');
    }

    console.log('codeforces', solvedProblems);
    return solvedProblems;
  } catch (error) {
    console.error('Error fetching Codeforces:', error.message);
    return 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing Codeforces browser:', e.message);
      }
    }
  }
}

async function fetchCodolio(url) {
  if (await inValidUrl(url)) {
    return 0;
  }

  let browser;
  try {
    console.log('Fetching Codolio:', url);
    const { page, browser: br } = await safeGotoNewPage(url);
    browser = br;

    const totalQuestions = await page.$eval(
      '#total_questions span.text-5xl',
      el => el.textContent.trim()
    );

    await page.waitForSelector('ul.flex.mt-2.gap-2.flex-col.w-full.pl-4.mb-2');
    const result = await page.$$eval(
      'li.flex.flex-col.round-border',
      (listItems) =>
        listItems.map((li) => {
          const name = li.querySelector('span.font-semibold.tracking-wide')?.textContent.trim();
          const href = li.querySelector('a[href^="http"]')?.href;
          let status = 0;
          if (li.querySelector('svg.text-green-500')) {
            status = 1;
          }
          return {
            [name || 'Unknown']: href || '',
            status
          };
        })
    );

    return { totalQuestions, result };
  } catch (error) {
    console.error('Error fetching Codolio:', error.message);
    return { totalQuestions: 0, result: [] };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('Error closing Codolio browser:', e.message);
      }
    }
  }
}

const getEmailTemplate = (entry) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Profile Status Update</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                🚀 Profile Status Update
            </h1>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            
            <p style="font-size: 16px; color: #2c3e50; margin-bottom: 20px;">
                Hi <strong style="color: #3498db; font-size: 18px;">${entry.name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #34495e; margin-bottom: 25px;">
                I hope you're doing well! I wanted to share an update on your coding profile status to help you stay on track for upcoming placement opportunities.
            </p>
            
            <div style="background: #e8f4fd; border-left: 5px solid #3498db; padding: 20px; margin: 25px 0; border-radius: 5px;">
                <h3 style="color: #2980b9; margin-top: 0; font-size: 20px;">📊 Your Current Profile Summary:</h3>
                
                <ul style="list-style: none; padding: 0;">
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #e74c3c;">
                        <strong style="color: #c0392b; font-size: 16px;">⏰ Pending Questions:</strong> 
                        <span style="color: #e74c3c; font-size: 18px; font-weight: bold;">${entry.due}</span> questions remaining
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 Total Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.total}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 Leetcode Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.leetcode}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 CodeStudio Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.codestudio}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 CodeChef Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.codechef}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 CodeForces Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.codeforces}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 Geeks for Geeks Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.gfg}</span>
                    </li>
                    <li style="margin: 15px 0; padding: 12px; background: white; border-radius: 8px; border-left: 4px solid #9b59b6;">
                        <strong style="color: #8e44ad; font-size: 16px;">🔄 InterviewBit Count:</strong> 
                        <span style="color: #9b59b6; font-size: 18px; font-weight: bold;">${entry.interviewbit}</span>
                    </li>
                </ul>
            </div>
            
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="color: #721c24; margin-top: 0; font-size: 18px;">🚨 Important Warning:</h3>
                <p style="color: #721c24; margin: 0; font-size: 15px; font-weight: 600;">
                    Poor performance in completing questions and maintaining your profile can significantly impact your placement opportunities. Companies closely monitor candidate consistency and problem-solving activity when making hiring decisions.
                </p>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="color: #856404; margin-top: 0; font-size: 18px;">💡 Why This Matters:</h3>
                <p style="color: #856404; margin: 0; font-size: 15px;">
                    Keeping your profiles updated and completing pending questions is crucial for placement success. Companies often review these metrics when evaluating candidates.
                </p>
            </div>
            
            <div style="background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="color: #0c5460; margin-top: 0; font-size: 18px;">🎯 Next Steps:</h3>
                <p style="color: #0c5460; font-size: 15px; margin-bottom: 15px;">
                    If you have pending questions, I'd recommend completing them soon to avoid any issues during the placement process. 
                </p>
                <p style="background: #17a2b8; color: white; padding: 15px; border-radius: 5px; font-size: 16px; font-weight: bold; text-align: center; margin: 15px 0;">
                    📝 Please maintain a minimum of 3 questions solved daily
                </p>
                <p style="color: #0c5460; font-size: 15px; margin: 0;">
                    to stay consistent and build strong problem-solving momentum. A complete and verified profile significantly improves your chances of landing your dream job!
                </p>
            </div>
            
            <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
                <p style="color: #155724; font-size: 16px; margin: 0;">
                    Need any help or guidance? Feel free to reach out - I'm here to support you in achieving your placement goals.
                </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding: 20px; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border-radius: 10px;">
                <p style="color: white; font-size: 18px; font-weight: bold; margin: 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
                    Best regards,<br>
                    <span style="font-size: 20px;">🤝 Your Placement Buddy</span>
                </p>
            </div>
            
        </div>
        
        <div style="text-align: center; padding: 20px; color: #7f8c8d; font-size: 12px;">
            <p>This is an automated message from your coding profile tracking system.</p>
        </div>
        
    </body>
    </html>
  `;
};

async function sendEmail(entry) {
  const mailOptions = {
    from: `"Profile Tracker" ${process.env.EMAIL}`,
    to: entry.email,
    subject: '🚀 Your Coding Profile Status - Action Required for Placement Success',
    html: getEmailTemplate(entry)
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.response);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

exports.handler = async (event) => {
  try {
    console.log('Starting profile fetching process...');
    console.log('Environment check:', {
      isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    });

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*');

    if (error) throw error;

    const emailQueue = [];
    console.log("Fetched profiles:", profiles.length);

    // Process profiles one by one to save memory
    for (const profile of profiles) {
      try {
        console.log(`Processing profile: ${profile.name || profile.email}`);
        if (!profile.prev_date) {
          profile.prev_date = new Date().toISOString();
        }
        const leetCount    = Math.max(await fetchLeetCode(profile.LeetCode), profile.LeetCode_Count || 0);
        const studioCount  = Math.max(await fetchCodeStudio(profile.CodeStudio), profile.CodeStudio_Count || 0);
        const chefCount    = Math.max(await fetchCodechef(profile.CodeChef), profile.CodeChef_Count || 0);
        const cfCount      = Math.max(await fetchCodeforces(profile.CodeForces), profile.CodeForces_Count || 0);
        const gfgCount     = Math.max(await fetchGFG(profile.GeeksForGeeks), profile.GeeksForGeeks_Count || 0);
        const ibCount      = Math.max(await fetchInterview(profile.InterviewBit), profile.InterviewBit_Count || 0);
        const prevDate = new Date(profile.prev_date);
        const now = new Date();

        const diffMs = now - prevDate; 
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        let num = leetCount + studioCount + chefCount + cfCount + gfgCount + ibCount;
        const prev = profile.prev_record;
        num = Math.max(num, prev);
        const due=Math.max(0,diffDays*3+prev-num)

        emailQueue.push({
          email: profile.email,
          name: profile.name || 'Student',
          due: due,
          leetcode: leetCount,
          codestudio: studioCount,
          codechef: chefCount,
          codeforces: cfCount,
          gfg: gfgCount,
          interviewbit: ibCount,
          total: num
        });

        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            prev_record: profile.prev_record,
            prev_date: new Date().toISOString(),
            LeetCode_Count: leetCount,
            CodeStudio_Count: studioCount,
            CodeChef_Count: chefCount,
            CodeForces_Count: cfCount,
            GeeksForGeeks_Count: gfgCount,
            InterviewBit_Count: ibCount,
          })
          .eq('email', profile.email);

        if (updateError) {
          console.error(`Failed to update profile for ${profile.email}:`, updateError.message);
        }

        // Longer throttle between profiles in Lambda
        await new Promise(res => setTimeout(res, 2000));

      } catch (profileError) {
        console.error(`Error processing profile ${profile.name || profile.email}:`, profileError.message);
      }
    }

    // Send emails sequentially
    console.log(`Sending ${emailQueue.length} emails...`);
    for (const entry of emailQueue) {
      try {
        await sendEmail(entry);
        await new Promise(resolve => setTimeout(resolve, 1000)); // rate limit emails
      } catch (emailError) {
        console.error(`Failed to send email to ${entry.email}:`, emailError.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: "Records updated successfully",
        profilesProcessed: profiles.length,
        emailsSent: emailQueue.length
      }),
    };

  } catch (err) {
    console.error('Error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// For local testing
if (require.main === module) {
  exports.handler().then((response) => {
    console.log('Function response:', response);
  }).catch((err) => {
    console.error('Unhandled error:', err);
  });
}