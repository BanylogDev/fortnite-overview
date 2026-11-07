
import { spawn, spawnSync, execFileSync } from "child_process";
import { createInterface } from "readline";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const engineDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ==========================================
// EPIC GAMES CONFIGURATION
// ==========================================

const clientId = "ec684b8c687f479fadea3cb2ad83f5c6";
const clientSecret = "e1f31c211f28413186262d37a13fc84d";

const EPIC_TOKEN_URL =
    "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";

const EPIC_EXCHANGE_URL =
    "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange";

// Direct authorization URL - no login page.
const EPIC_REDIRECT_URL =
    `https://www.epicgames.com/id/api/redirect?clientId=${clientId}&responseType=code`;

const basic = Buffer
    .from(`${clientId}:${clientSecret}`)
    .toString("base64");

// ==========================================
// DEPENDENCY INSTALLATION
// ==========================================

function installDependencies() {
    console.log("\n====================================");
    console.log("       CHECKING DEPENDENCIES");
    console.log("====================================\n");

    const requiredPackages = [
        "jimp",
        "axios",
        "screenshot-desktop",
        "tesseract.js"
    ];

    const missingPackages = requiredPackages.filter(packageName => {
        try {
            require.resolve(packageName);
            return false;
        } catch {
            return true;
        }
    });

    if (missingPackages.length === 0) {
        console.log("[+] All dependencies are installed.");
        return;
    }

    console.log(`[!] Installing: ${missingPackages.join(", ")}`);

    try {
        if (process.platform === "win32") {
            // Run npm through cmd.exe without shell: true.
            execFileSync(
                "cmd.exe",
                [
                    "/d",
                    "/s",
                    "/c",
                    `npm install ${missingPackages.join(" ")}`
                ],
                {
                    stdio: "inherit",
                    windowsHide: true
                }
            );
        } else {
            execFileSync(
                "npm",
                ["install", ...missingPackages],
                {
                    stdio: "inherit"
                }
            );
        }

        console.log("\n[+] Dependencies installed successfully.");
    } catch (error) {
        throw new Error("Failed to install dependencies.");
    }
}

// ==========================================
// OPEN DEFAULT BROWSER
// ==========================================

function openDefaultBrowser(url) {
    console.log("[+] Opening your default browser...");

    let command;
    let args;

    if (process.platform === "win32") {
        command = "rundll32.exe";
        args = ["url.dll,FileProtocolHandler", url];
    } else if (process.platform === "darwin") {
        command = "open";
        args = [url];
    } else {
        command = "xdg-open";
        args = [url];
    }

    const browser = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });

    browser.unref();
}

function focusCommandWindow() {
    if (process.platform !== "win32") return;

    try {
        execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                path.join(engineDirectory, "Code", "focusConsole.ps1")
            ],
            { stdio: "ignore", timeout: 3000 }
        );
    } catch {
        // If Windows blocks foreground activation, the user can still switch back manually.
    }
}

function reportAuthorizationResult(accepted, message) {
    const color = accepted ? "\u001b[32m" : "\u001b[31m";
    const reset = "\u001b[0m";
    const canColor =
        process.stdout.isTTY &&
        process.stdout.hasColors?.() &&
        process.env.NO_COLOR === undefined;

    console.log(canColor ? `${color}${message}${reset}` : message);

    if (process.platform === "win32") {
        try {
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    path.join(engineDirectory, "Code", "playAuthSound.ps1"),
                    accepted ? "accepted" : "declined"
                ],
                { stdio: "ignore", timeout: 2000 }
            );
        } catch {
            process.stdout.write("\u0007");
        }
    } else {
        process.stdout.write("\u0007");
    }
}

// ==========================================
// USER INPUT
// ==========================================

function askQuestion(question) {
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        readline.question(question, answer => {
            readline.close();
            resolve(answer.trim());
        });
    });
}

// ==========================================
// AUTHORIZATION CODE EXTRACTION
// ==========================================

function extractAuthorizationCodes(input) {
    const codes = [];
    const seen = new Set();

    function addCode(value) {
        if (typeof value !== "string") return;

        const original = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (original.length < 20 || original.length > 64) return;

        const corrected = original
            .replace(/o/g, "0")
            .replace(/[il]/g, "1")
            .replace(/s/g, "5")
            .replace(/g/g, "6")
            .replace(/z/g, "2")
            .replace(/q/g, "9");

        function addHexCandidate(candidate) {
            if (!/^[a-f0-9]{20,64}$/.test(candidate) || seen.has(candidate)) return;
            seen.add(candidate);
            codes.push(candidate);
        }

        addHexCandidate(corrected);

        // OCR sometimes reads an 8 as b. Keep the literal read first, then try
        // a few single-character corrections; Epic's exchange validates each.
        for (let index = 0, corrections = 0; index < original.length && corrections < 3; index += 1) {
            if (original[index] !== "b") continue;
            addHexCandidate(`${original.slice(0, index)}8${original.slice(index + 1)}`);
            corrections += 1;
        }
    }

    const text = String(input || "").trim();

    // Prefer the two explicit copies Epic shows in its JSON response.
    try {
        const json = JSON.parse(text);
        addCode(json.authorizationCode);

        if (json.redirectUrl) {
            addCode(new URL(json.redirectUrl).searchParams.get("code"));
        }
    } catch {
        // OCR text may not be valid JSON.
    }

    // OCR may return the JSON fields or URL as plain text.
    const patterns = [
        /authorization\s*code\s*["']?\s*[:=]\s*["']?([a-z0-9][a-z0-9\s]{18,63})/gi,
        /[?&]\s*code\s*=\s*([a-z0-9]{20,64})/gi
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            addCode(match[1]);
        }
    }

    // Last resort: look for standalone hex strings, after field-specific matches.
    for (const match of text.matchAll(/\b[a-z0-9]{20,64}\b/gi)) {
        addCode(match[0]);
    }

    return codes;
}

function extractAuthorizationCode(input) {
    return extractAuthorizationCodes(input)[0] || null;
}

// ==========================================
// READ AUTHORIZATION CODE FROM THE EXISTING BROWSER
// ==========================================

async function captureAuthorizationCodeFromScreen(attemptNumber = 1) {
    if (process.platform !== "win32") return [];

    let worker;
    let screenshots = [];

    try {
        const screenshotDesktop = require("screenshot-desktop");
        const displays = await screenshotDesktop.listDisplays();
        const screens = displays.length > 0 ? displays : [null];

        // Allow the page to load on the first try; retries use a shorter wait.
        await new Promise(resolve => setTimeout(resolve, attemptNumber === 1 ? 1800 : 1100));

        screenshots = await Promise.all(
            screens.map(display => {
                const options = { format: "png" };
                if (display) options.screen = display.id;
                return screenshotDesktop(options);
            })
        );
    } catch (error) {
        focusCommandWindow();
        console.log(`[!] Could not capture the browser screen: ${error.message}`);
        return [];
    }

    // Return the user's focus before slower OCR and token validation work.
    focusCommandWindow();
    console.log("[+] Screenshot captured. Reading the authorization code...");

    try {
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker("eng", 1, {
            cacheMethod: "none",
            logger: () => {}
        });
        await worker.setParameters({
            tessedit_pageseg_mode: "6",
            user_defined_dpi: "300"
        });

        const codes = [];
        const seen = new Set();

        function addCodes(values) {
            for (const code of values) {
                const normalized = code.toLowerCase();
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    codes.push(code);
                }
            }
        }

        const Jimp = require("jimp");

        for (const screenshot of screenshots) {
            const screenImage = await Jimp.read(screenshot);
            const cropTop = Math.floor(screenImage.bitmap.height * 0.05);
            const cropHeight = Math.max(1, Math.floor(screenImage.bitmap.height * 0.4));
            const jsonArea = screenImage
                .clone()
                .crop(0, cropTop, screenImage.bitmap.width, cropHeight)
                .greyscale()
                .contrast(0.25);

            // The Epic JSON is at the top of the browser page; cropping removes
            // the browser chrome and command window from the OCR input.
            const cropResult = await worker.recognize(
                await jsonArea.getBufferAsync(Jimp.MIME_PNG)
            );
            addCodes(extractAuthorizationCodes(cropResult.data.text || ""));

            // A larger second pass helps distinguish small or similar glyphs.
            jsonArea.resize(jsonArea.bitmap.width * 2, jsonArea.bitmap.height * 2);
            const enlargedResult = await worker.recognize(
                await jsonArea.getBufferAsync(Jimp.MIME_PNG)
            );
            addCodes(extractAuthorizationCodes(enlargedResult.data.text || ""));
        }

        return codes.slice(0, 4);
    } catch (error) {
        console.log(`[!] Automatic screen reading was unavailable: ${error.message}`);
    } finally {
        if (worker) {
            await worker.terminate().catch(() => {});
        }
    }

    return [];
}

async function getAuthorizationCodes(attemptNumber) {
    if (attemptNumber === 1) {
        console.log("\n====================================");
        console.log("          EPIC AUTHENTICATION");
        console.log("====================================\n");

        console.log("Make sure you are already logged into");
        console.log("Epic Games in your default browser.\n");
    }

    console.log(`[+] Opening Epic authorization page (attempt ${attemptNumber} of 3)...`);
    console.log("[i] The screen will be captured, then this window will return automatically.");
    console.log("[i] The screenshot is processed in memory and is not saved.");

    openDefaultBrowser(EPIC_REDIRECT_URL);
    return captureAuthorizationCodeFromScreen(attemptNumber);
}

async function requestAuthorizationToken(code) {
    const token = await requestToken({
        grant_type: "authorization_code",
        code
    });

    if (!token.access_token) {
        throw new Error("Epic did not return an access token.");
    }

    return token;
}

async function getManualAuthorizationToken() {
    while (true) {
        const input = await askQuestion("Authorization code: ");
        const code = extractAuthorizationCode(input);

        if (!code) {
            console.log("\n[!] That does not look like a valid authorization code. Try again.\n");
            continue;
        }

        try {
            const token = await requestAuthorizationToken(code);
            reportAuthorizationResult(true, "[+] Epic accepted the authorization code.");
            return token;
        } catch (error) {
            reportAuthorizationResult(false, "[!] Epic rejected the authorization code.");
            console.log("\n    Epic could not verify that code.");
            console.log("    Paste a fresh authorization code and try again.\n");
        }
    }
}

// ==========================================
// EPIC TOKEN REQUEST
// ==========================================

async function requestToken(body) {
    const response = await fetch(EPIC_TOKEN_URL, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams(body)
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(`Epic token request failed (HTTP ${response.status}).`);
        error.status = response.status;
        error.responseData = data;
        throw error;
    }

    return data;
}

// ==========================================
// AUTHENTICATION
// ==========================================

async function authenticate() {
    let initialToken = null;

    for (let attempt = 1; attempt <= 3 && !initialToken; attempt += 1) {
        const authorizationCodes = await getAuthorizationCodes(attempt);

        for (const authorizationCode of authorizationCodes) {
            try {
                // This is both validation and the one-time code exchange.
                initialToken = await requestAuthorizationToken(authorizationCode);
                break;
            } catch (error) {
                const invalidCode =
                    error.responseData?.error === "invalid_grant" ||
                    String(error.responseData?.errorCode || "").includes("authorization_code_not_found");

                if (!invalidCode) break;
            }
        }

        if (!initialToken && attempt < 3) {
            console.log("\n[!] Epic did not accept that screen reading.");
            console.log(`    Taking a fresh screenshot and retrying (${attempt + 1} of 3)...\n`);
        }
    }

    if (initialToken) {
        reportAuthorizationResult(true, "[+] Epic accepted the automatically detected code.");
    } else {
        reportAuthorizationResult(false, "[!] Automatic authorization failed after 3 attempts.");
        console.log("\n    The code may have been read incorrectly or Epic may need a fresh response.");
        console.log("    Paste a fresh authorizationCode from Epic's JSON below.\n");
    }

    if (!initialToken) {
        initialToken = await getManualAuthorizationToken();
    }

    console.log("[+] Authorization successful.");
    console.log("[+] Requesting exchange code...");

    const exchangeResponse = await fetch(EPIC_EXCHANGE_URL, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${initialToken.access_token}`
        }
    });

    const exchangeData = await exchangeResponse.json();

    if (!exchangeResponse.ok || !exchangeData.code) {
        throw new Error(
            `Epic exchange request failed: ${JSON.stringify(exchangeData)}`
        );
    }

    console.log("[+] Exchange code received.");
    console.log("[+] Generating Fortnite access token...");

    const finalToken = await requestToken({
        grant_type: "exchange_code",
        exchange_code: exchangeData.code
    });

    if (!finalToken.access_token || !finalToken.account_id) {
        throw new Error("Failed to obtain Fortnite access token.");
    }

    console.log("[+] Fortnite authentication completed.");

    return {
        accessToken: finalToken.access_token,
        accountId: finalToken.account_id
    };
}

// ==========================================
// GENERATE LOCKER IMAGES
// ==========================================

async function generateLockers(auth) {
    console.log("\n====================================");
    console.log("       GENERATING LOCKER IMAGES");
    console.log("====================================\n");

    const { generateAllLockerImages } =
        await import("./generateLocker.js");

    if (typeof generateAllLockerImages !== "function") {
        throw new Error(
            "generateAllLockerImages() was not found in generateLocker.js."
        );
    }

    const result = await generateAllLockerImages({
        accessToken: auth.accessToken,
        accountId: auth.accountId,
        savePath: path.resolve(engineDirectory, "..", "images")
    });

    if (!result) {
        throw new Error("Locker generation returned no result.");
    }

    console.log("\n[+] Locker generation completed.");

    return result;
}

// ==========================================
// MAIN
// ==========================================

async function main() {
    try {
        console.log("\n====================================");
        console.log("       FORTNITE LOCKER GENERATOR");
        console.log("====================================");

        installDependencies();

        const auth = await authenticate();

        await generateLockers(auth);

        console.log("\n====================================");
        console.log("          PROCESS COMPLETED");
        console.log("====================================\n");

    } catch (error) {
        console.error("\n[ERROR]", error.message);
        process.exitCode = 1;
    }
}

main();
