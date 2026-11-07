
import Jimp from "jimp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import axios from "axios";

const engineDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ============================================================
// CONFIGURATION
// ============================================================

const TYPE_MAPPING = {
    outfit: {
        prefix: "AthenaCharacter:",
        backendValue: "AthenaCharacter",
        apiValue: "outfit",
        fileName: "outfits.png"
    },
    backpack: {
        prefix: "AthenaBackpack:",
        backendValue: "AthenaBackpack",
        apiValue: "backpack",
        fileName: "backpacks.png"
    },
    pickaxe: {
        prefix: "AthenaPickaxe:",
        backendValue: "AthenaPickaxe",
        apiValue: "pickaxe",
        fileName: "pickaxes.png"
    },
    glider: {
        prefix: "AthenaGlider:",
        backendValue: "AthenaGlider",
        apiValue: "glider",
        fileName: "gliders.png"
    },
    emote: {
        prefix: "AthenaDance:",
        backendValue: "AthenaDance",
        apiValue: "emote",
        fileName: "emotes.png"
    },
    spray: {
        prefix: "AthenaDance:",
        backendValue: "AthenaDance",
        apiValue: "spray",
        fileName: "sprays.png"
    },
    emoticon: {
        prefix: "AthenaDance:",
        backendValue: "AthenaDance",
        apiValue: "emoji",
        fileName: "emoticons.png"
    },
    toy: {
        prefix: "AthenaDance:",
        backendValue: "AthenaDance",
        apiValue: "toy",
        fileName: "toys.png"
    },
    wrap: {
        prefix: "AthenaItemWrap:",
        backendValue: "AthenaItemWrap",
        apiValue: "wrap",
        fileName: "wraps.png"
    },
    music: {
        prefix: "AthenaMusicPack:",
        backendValue: "AthenaMusicPack",
        apiValue: "music",
        fileName: "music.png"
    },
    loadingscreen: {
        prefix: "AthenaLoadingScreen:",
        backendValue: "AthenaLoadingScreen",
        apiValue: "loadingscreen",
        fileName: "loading_screens.png"
    },
    contrail: {
        prefix: "AthenaSkyDiveContrail:",
        backendValue: "AthenaSkyDiveContrail",
        apiValue: "contrail",
        fileName: "contrails.png"
    }
};

const TYPE_ORDER = Object.keys(TYPE_MAPPING);

const CONFIG = {
    CARD_WIDTH: 192,
    CARD_HEIGHT: 192,
    CARD_SPACING: 12,
    CANVAS_PADDING: 36,

    MAX_OUTPUT_DIMENSION: 3072,

    DOWNLOAD_CONCURRENCY: 32,
    CATEGORY_CONCURRENCY: 3,

    DOWNLOAD_TIMEOUT: 8000,
    API_TIMEOUT: 20000,

    BACKGROUND_COLOR: 0x0a0e27ff,

    API_URL:
        "https://fortnite-api.com/v2/cosmetics/br?language=es",

    ASSETS: {
        missing: path.join(engineDirectory, "UI", "images", "QuestionMark.png"),
        largeOverlay: path.join(engineDirectory, "UI", "images", "LargeOverlay.png"),
        smallOverlay: path.join(engineDirectory, "UI", "images", "SmallOverlay.png"),
        font20: path.join(engineDirectory, "UI", "fonts", "burbark", "burbark_20.fnt"),
        font64: path.join(engineDirectory, "UI", "fonts", "burbark", "burbark_64.fnt")
    }
};

const imageHttpAgent = new https.Agent({
    keepAlive: true,
    maxSockets: CONFIG.DOWNLOAD_CONCURRENCY * CONFIG.CATEGORY_CONCURRENCY,
    maxFreeSockets: 32
});

// ============================================================
// CACHES
// ============================================================

const assetCache = new Map();

let cosmeticsApiCache = null;

// ============================================================
// UTILITIES
// ============================================================

function validateType(type) {
    if (!Object.prototype.hasOwnProperty.call(TYPE_MAPPING, type)) {
        throw new Error(`Invalid cosmetic type: ${type}`);
    }
}

function normalizeId(id) {
    return String(id || "").toLowerCase();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadAsset(filePath) {
    if (!assetCache.has(filePath)) {
        const promise = Jimp.read(filePath)
            .then(image => image.resize(CONFIG.CARD_WIDTH, CONFIG.CARD_HEIGHT))
            .catch(error => {
                assetCache.delete(filePath);
                throw error;
            });

        assetCache.set(filePath, promise);
    }

    return (await assetCache.get(filePath)).clone();
}

// ============================================================
// COSMETICS API
// ============================================================

function collectCosmetics(data, output = []) {
    if (!data) return output;

    if (Array.isArray(data)) {
        for (const item of data) {
            collectCosmetics(item, output);
        }

        return output;
    }

    if (typeof data !== "object") {
        return output;
    }

    if (data.id && data.type) {
        output.push(data);
        return output;
    }

    for (const value of Object.values(data)) {
        collectCosmetics(value, output);
    }

    return output;
}

async function getCosmeticsAPI() {
    if (!cosmeticsApiCache) {
        cosmeticsApiCache = axios.get(CONFIG.API_URL, {
            timeout: CONFIG.API_TIMEOUT
        })
        .then(response => {
            const data = response.data?.data;

            if (!data) {
                throw new Error(
                    "Fortnite cosmetics API returned no data."
                );
            }

            const cosmetics = collectCosmetics(data);

            if (cosmetics.length === 0) {
                throw new Error(
                    "No cosmetics were found in the API response."
                );
            }

            console.log(
                `[+] Loaded ${cosmetics.length.toLocaleString()} cosmetics.`
            );

            return cosmetics;
        })
        .catch(error => {
            cosmeticsApiCache = null;
            throw error;
        });
    }

    return cosmeticsApiCache;
}

function createCosmeticIndex(apiCosmetics) {
    const index = new Map();

    for (const cosmetic of apiCosmetics) {
        if (!cosmetic?.id) continue;

        const id = normalizeId(cosmetic.id);

        if (!index.has(id)) {
            index.set(id, []);
        }

        index.get(id).push(cosmetic);
    }

    return index;
}

function findCosmetic(index, cosmeticId, cosmeticType) {
    const candidates = index.get(normalizeId(cosmeticId));

    if (!candidates) return null;

    const mapping = TYPE_MAPPING[cosmeticType];

    return candidates.find(cosmetic => {
        return (
            cosmetic.type?.backendValue === mapping.backendValue &&
            String(cosmetic.type?.value || "").toLowerCase() ===
                mapping.apiValue
        );
    }) || null;
}

// ============================================================
// FORTNITE PROFILE
// ============================================================

async function composeMCP({
    operation,
    profile,
    accountId,
    accessToken,
    body = {},
    route = "client"
}) {
    const url =
        `https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/${route}/${operation}?profileId=${profile}&rvn=-1`;

    const response = await axios.post(url, body, {
        timeout: CONFIG.API_TIMEOUT,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        }
    });

    return response.data;
}

async function getProfileData(accountId, accessToken) {
    console.log("[+] Requesting Athena profile...");

    const athenaResponse = await composeMCP({
        profile: "athena",
        operation: "QueryProfile",
        accountId,
        accessToken
    });

    const athenaProfile =
        athenaResponse?.profileChanges?.[0]?.profile;

    if (!athenaProfile) {
        throw new Error(
            "Could not retrieve the Fortnite Athena profile."
        );
    }

    console.log("[+] Requesting Common Core profile...");

    let commonCoreProfile = null;

    try {
        const commonCoreResponse = await composeMCP({
            profile: "common_core",
            operation: "QueryProfile",
            accountId,
            accessToken
        });

        commonCoreProfile =
            commonCoreResponse?.profileChanges?.[0]?.profile || null;

    } catch (error) {
        console.log(
            "[!] Common Core profile unavailable:",
            error.response?.data?.errorMessage || error.message
        );
    }

    return {
        athenaItems: athenaProfile.items || {},
        athenaStats: athenaProfile.stats?.attributes || {},

        commonCoreItems: commonCoreProfile?.items || {},
        commonCoreStats: commonCoreProfile?.stats?.attributes || {}
    };
}

// ============================================================
// INVENTORY PROCESSING
// ============================================================

function getUserCosmetics(items, type) {
    validateType(type);

    const mapping = TYPE_MAPPING[type];
    const cosmetics = [];

    for (const itemData of Object.values(items)) {
        const templateId = itemData?.templateId;

        if (
            typeof templateId !== "string" ||
            !templateId.startsWith(mapping.prefix)
        ) {
            continue;
        }

        const cosmeticId = templateId.slice(
            mapping.prefix.length
        );

        cosmetics.push({
            id: cosmeticId,
            templateId,
            type
        });
    }

    return cosmetics;
}

// ============================================================
// RARITY AND SORTING
// ============================================================

function getRarityWeight(rarity) {
    const weights = {
        legendary: 100,
        epic: 90,
        rare: 80,
        uncommon: 70,
        common: 60,
        gaminglegends: 200,
        marvel: 190,
        starwars: 180,
        dc: 170,
        icon: 160,
        dark: 150,
        shadow: 140,
        slurp: 130,
        frozen: 120,
        lava: 110
    };

    return weights[String(rarity || "common").toLowerCase()] || 50;
}

function parseAddedDate(value) {
    if (!value) return 0;

    const timestamp = new Date(value).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortCosmetics(cosmetics) {
    return cosmetics.sort((a, b) => {
        const rarityDifference =
            getRarityWeight(b.rarity) -
            getRarityWeight(a.rarity);

        if (rarityDifference !== 0) {
            return rarityDifference;
        }

        const dateDifference =
            parseAddedDate(b.added) -
            parseAddedDate(a.added);

        if (dateDifference !== 0) {
            return dateDifference;
        }

        return (a.name || a.id || "").localeCompare(
            b.name || b.id || ""
        );
    });
}

function detectRarity(cosmetic) {
    let rarity =
        cosmetic?.rarity?.value?.toLowerCase() || "common";

    const series =
        cosmetic?.series?.value?.trim().toLowerCase() || "";

    const mappings = [
        ["idol", "icon"],
        ["idolo", "icon"],
        ["ídolo", "icon"],
        ["oscura", "dark"],
        ["shadow", "shadow"],
        ["cobra", "shadow"],
        ["slurp", "slurp"],
        ["sorbete", "slurp"],
        ["marvel", "marvel"],
        ["star wars", "starwars"],
        ["dc", "dc"],
        ["gaming", "gaminglegends"],
        ["leyendas", "gaminglegends"],
        ["frozen", "frozen"],
        ["congelada", "frozen"],
        ["lava", "lava"]
    ];

    for (const [keyword, mappedRarity] of mappings) {
        if (series.includes(keyword)) {
            rarity = mappedRarity;
            break;
        }
    }

    return rarity;
}

// ============================================================
// DIMENSIONS
// ============================================================

function calculateDimensions(itemCount) {
    const {
        CARD_WIDTH,
        CARD_HEIGHT,
        CARD_SPACING,
        CANVAS_PADDING
    } = CONFIG;

    if (itemCount <= 0) return null;

    const columns = Math.ceil(Math.sqrt(itemCount));
    const rows = Math.ceil(itemCount / columns);

    return {
        columns,
        rows,

        width:
            columns * CARD_WIDTH +
            (columns + 1) * CARD_SPACING +
            CANVAS_PADDING * 2,

        height:
            rows * CARD_HEIGHT +
            (rows + 1) * CARD_SPACING +
            CANVAS_PADDING * 2
    };
}

// ============================================================
// IMAGE DOWNLOADING
// ============================================================

async function downloadImage(url, fallback) {
    if (!url) return fallback.clone();

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: CONFIG.DOWNLOAD_TIMEOUT,
                maxContentLength: 10 * 1024 * 1024,
                maxBodyLength: 10 * 1024 * 1024,
                httpsAgent: imageHttpAgent
            });

            return await Jimp.read(Buffer.from(response.data));

        } catch (error) {
            const status = error.response?.status;
            const retryable =
                !status || status === 408 || status === 429 || status >= 500;

            if (attempt === 0 && retryable) {
                await sleep(150);
                continue;
            }

            return fallback.clone();
        }
    }

    return fallback.clone();
}

// ============================================================
// COSMETIC IMAGE PREPARATION
// ============================================================

async function processCosmetic(
    cosmetic,
    index,
    dimensions,
    assets
) {
    const {
        CARD_WIDTH,
        CARD_HEIGHT,
        CARD_SPACING,
        CANVAS_PADDING
    } = CONFIG;

    const x =
        CANVAS_PADDING +
        (index % dimensions.columns) *
            (CARD_WIDTH + CARD_SPACING);

    const y =
        CANVAS_PADDING +
        Math.floor(index / dimensions.columns) *
            (CARD_HEIGHT + CARD_SPACING);

    const itemImage = await downloadImage(
        cosmetic.imageUrl,
        assets.missing
    );

    itemImage.resize(CARD_WIDTH, CARD_HEIGHT);

    let background;

    const series = cosmetic.series;

    const rarity = String(
        cosmetic.rarity || "Common"
    );

    const backgroundPath = series
        ? path.join(engineDirectory, "UI", "images", "series", `${series}.png`)
        : path.join(engineDirectory, "UI", "images", "rarities", `${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}.png`);

    try {
        background = await loadAsset(backgroundPath);
    } catch {
        background = await loadAsset(
            path.join(engineDirectory, "UI", "images", "rarities", "Common.png")
        );
    }

    background.blit(itemImage, 0, 0);

    const textHeight = Jimp.measureTextHeight(
        assets.font20,
        cosmetic.name,
        CARD_WIDTH - 16
    );

    const isSmallText = textHeight <= 22;

    const textPosition = isSmallText
        ? Math.round(CARD_HEIGHT * 0.80)
        : Math.round(CARD_HEIGHT * 0.72);

    const overlay = isSmallText
        ? assets.smallOverlay
        : assets.largeOverlay;

    background.blit(overlay, 0, 0);

    background.print(
        assets.font20,
        8,
        textPosition,
        {
            text: cosmetic.name,
            alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
        },
        CARD_WIDTH - 16
    );

    return {
        image: background,
        x,
        y
    };
}

// ============================================================
// BATCH PROCESSING
// ============================================================

async function processInBatches(
    items,
    concurrency,
    callback
) {
    let nextIndex = 0;

    const workerCount = Math.min(concurrency, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;

            const result = await callback(items[index], index);

            // Release each decoded image as soon as it has been composited.
            if (result) result.image = null;
        }
    });

    await Promise.all(workers);
}

// ============================================================
// SINGLE CATEGORY GENERATOR
// ============================================================

async function generateCategory({
    type,
    items,
    apiIndex,
    savePath,
    assets
}) {
    validateType(type);

    const userCosmetics = getUserCosmetics(
        items,
        type
    );

    if (userCosmetics.length === 0) {
        return {
            success: true,
            type,
            skipped: true,
            count: 0,
            message: "No cosmetics in this category."
        };
    }

    const processedCosmetics = [];
    const seenIds = new Set();

    for (const userCosmetic of userCosmetics) {
        const cosmetic = findCosmetic(
            apiIndex,
            userCosmetic.id,
            type
        );

        const id = normalizeId(userCosmetic.id);

        if (seenIds.has(id)) continue;

        seenIds.add(id);

        processedCosmetics.push({
            id: userCosmetic.id,

            name: cosmetic?.name || userCosmetic.id,

            rarity: cosmetic ? detectRarity(cosmetic) : "Common",

            series: cosmetic?.series?.backendValue,

            imageUrl:
                cosmetic?.images?.icon ||
                cosmetic?.images?.smallIcon ||
                cosmetic?.images?.featured,

            added: cosmetic?.added
        });
    }

    const sortedCosmetics = sortCosmetics(
        processedCosmetics
    );

    const dimensions = calculateDimensions(
        sortedCosmetics.length
    );

    const canvas = new Jimp(
        dimensions.width,
        dimensions.height,
        CONFIG.BACKGROUND_COLOR
    );

    console.log(
        `    ${sortedCosmetics.length} ${type} items found.`
    );

    await processInBatches(
        sortedCosmetics,
        CONFIG.DOWNLOAD_CONCURRENCY,
        async (cosmetic, index) => {
            const result = await processCosmetic(
                cosmetic,
                index,
                dimensions,
                assets
            );

            canvas.blit(
                result.image,
                result.x,
                result.y
            );

            return result;
        }
    );

    // Resize the final image without changing its aspect ratio.
    const scale = Math.min(
        1,
        CONFIG.MAX_OUTPUT_DIMENSION / dimensions.width,
        CONFIG.MAX_OUTPUT_DIMENSION / dimensions.height
    );

    if (scale < 1) {
        canvas.resize(
            Math.max(1, Math.round(dimensions.width * scale)),
            Math.max(1, Math.round(dimensions.height * scale))
        );
    }

    await fs.promises.mkdir(savePath, {
        recursive: true
    });

    const fileName = TYPE_MAPPING[type].fileName;

    const outputPath = path.join(
        savePath,
        fileName
    );

    await canvas.writeAsync(outputPath);

    const stats = await fs.promises.stat(outputPath);

    if (!stats.size) {
        throw new Error(
            `Generated file is empty: ${outputPath}`
        );
    }

    console.log(
        `    [+] Saved ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
    );

    return {
        success: true,
        type,
        fileName,
        path: outputPath,
        count: sortedCosmetics.length,
        width: canvas.getWidth(),
        height: canvas.getHeight(),
        sizeBytes: stats.size
    };
}

// ============================================================
// V-BUCKS
// ============================================================

function getVbucksBalance(items) {
    let total = 0;

    for (const item of Object.values(items || {})) {
        const templateId = item?.templateId || "";

        if (
            templateId.startsWith("Currency:Mtx") &&
            Number.isFinite(Number(item.quantity))
        ) {
            total += Number(item.quantity);
        }
    }

    return total;
}

// ============================================================
// ACCOUNT OVERVIEW IMAGE
// ============================================================

async function generateAccountOverview({
    accountId,
    profile,
    categoryResults,
    savePath,
    assets
}) {
    const WIDTH = 1600;
    const HEIGHT = 1250;

    const image = new Jimp(
        WIDTH,
        HEIGHT,
        CONFIG.BACKGROUND_COLOR
    );

    const totalCosmetics = categoryResults.reduce(
        (sum, result) => sum + (result.count || 0),
        0
    );

    const vbucks = getVbucksBalance(
        profile.commonCoreItems
    );

    const athenaStats = profile.athenaStats || {};
    const commonStats = profile.commonCoreStats || {};

    const accountLevel =
        athenaStats.accountLevel ??
        commonStats.accountLevel ??
        "Unavailable";

    const seasonLevel =
        athenaStats.seasonLevel ??
        commonStats.seasonLevel ??
        "Unavailable";

    const season =
        athenaStats.season_num ??
        commonStats.season_num ??
        "Unavailable";

    const wins =
        athenaStats.lifetimeWins ??
        athenaStats.lifetime_wins ??
        "Unavailable";

    const overviewLines = [
        ["ACCOUNT ID", accountId],
        ["ACCOUNT LEVEL", accountLevel],
        ["SEASON LEVEL", seasonLevel],
        ["CURRENT SEASON", season],
        ["LIFETIME WINS", wins],
        ["V-BUCKS BALANCE", vbucks.toLocaleString("en-US")],
        ["TOTAL COSMETICS", totalCosmetics.toLocaleString("en-US")],
        [
            "CATEGORIES GENERATED",
            `${categoryResults.filter(r => r.success && !r.skipped).length}/${TYPE_ORDER.length}`
        ],
        ["ACCOUNT CREATED", "Unavailable"]
    ];

    image.print(
        assets.font64,
        55,
        45,
        "FORTNITE ACCOUNT"
    );

    image.print(
        assets.font64,
        55,
        120,
        "OVERVIEW"
    );

    image.print(
        assets.font20,
        60,
        220,
        `GENERATED ${new Date().toLocaleString()}`
    );

    let y = 320;

    for (const [label, value] of overviewLines) {
        image.print(
            assets.font20,
            75,
            y,
            `${label}:`
        );

        image.print(
            assets.font20,
            570,
            y,
            String(value)
        );

        y += 65;
    }

    y += 35;

    image.print(
        assets.font64,
        55,
        y,
        "COSMETIC COLLECTION"
    );

    y += 100;

    for (const type of TYPE_ORDER) {
        const result = categoryResults.find(
            entry => entry.type === type
        );

        const label = type.toUpperCase();

        const count = result?.success
            ? result.count
            : "FAILED";

        image.print(
            assets.font20,
            75,
            y,
            `${label}: ${count}`
        );

        y += 45;
    }

    const outputPath = path.join(
        savePath,
        "account_overview.png"
    );

    await image.writeAsync(outputPath);

    const stats = await fs.promises.stat(outputPath);

    if (!stats.size) {
        throw new Error(
            "Account overview image is empty."
        );
    }

    return {
        path: outputPath,
        sizeBytes: stats.size,
        width: WIDTH,
        height: HEIGHT
    };
}

// ============================================================
// INITIALIZATION
// ============================================================

async function initializeAssets() {
    console.log("[+] Loading image assets...");

    const [
        missing,
        largeOverlay,
        smallOverlay,
        font20,
        font64
    ] = await Promise.all([
        Jimp.read(CONFIG.ASSETS.missing),

        Jimp.read(CONFIG.ASSETS.largeOverlay),

        Jimp.read(CONFIG.ASSETS.smallOverlay),

        Jimp.loadFont(CONFIG.ASSETS.font20),

        Jimp.loadFont(CONFIG.ASSETS.font64)
    ]);

    return {
        missing,

        largeOverlay: largeOverlay.resize(
            CONFIG.CARD_WIDTH,
            CONFIG.CARD_HEIGHT
        ),

        smallOverlay: smallOverlay.resize(
            CONFIG.CARD_WIDTH,
            CONFIG.CARD_HEIGHT
        ),

        font20,
        font64
    };
}

// ============================================================
// PUBLIC FUNCTION: ONE CATEGORY
// ============================================================

export async function generateLockerImage({
    accessToken,
    accountId,
    type,
    savePath = path.resolve(engineDirectory, "..", "images")
}) {
    const startTime = Date.now();

    try {
        if (!accessToken || !accountId) {
            throw new Error(
                "Missing accessToken or accountId."
            );
        }

        validateType(type);

        const [
            profile,
            apiCosmetics,
            assets
        ] = await Promise.all([
            getProfileData(accountId, accessToken),
            getCosmeticsAPI(),
            initializeAssets()
        ]);

        const apiIndex = createCosmeticIndex(
            apiCosmetics
        );

        const result = await generateCategory({
            type,
            items: profile.athenaItems,
            apiIndex,
            savePath,
            assets
        });

        return {
            ...result,
            time: (
                (Date.now() - startTime) / 1000
            ).toFixed(2)
        };

    } catch (error) {
        return {
            success: false,
            type,
            error: error.message,
            time: (
                (Date.now() - startTime) / 1000
            ).toFixed(2)
        };
    }
}

// ============================================================
// PUBLIC FUNCTION: ALL CATEGORIES
// ============================================================

export async function generateAllLockerImages({
    accessToken,
    accountId,
    savePath = path.resolve(engineDirectory, "..", "images")
}) {
    const startTime = Date.now();

    try {
        if (!accessToken || !accountId) {
            throw new Error(
                "Missing accessToken or accountId."
            );
        }

        await fs.promises.mkdir(savePath, {
            recursive: true
        });

        console.log("\n====================================");
        console.log("       FORTNITE LOCKER GENERATOR");
        console.log("====================================\n");

        const [
            profile,
            apiCosmetics,
            assets
        ] = await Promise.all([
            getProfileData(accountId, accessToken),
            getCosmeticsAPI(),
            initializeAssets()
        ]);

        const apiIndex = createCosmeticIndex(
            apiCosmetics
        );

        const results = [];

        // Process a limited number of categories concurrently.
        for (
            let i = 0;
            i < TYPE_ORDER.length;
            i += CONFIG.CATEGORY_CONCURRENCY
        ) {
            const batch = TYPE_ORDER.slice(
                i,
                i + CONFIG.CATEGORY_CONCURRENCY
            );

            const batchResults = await Promise.all(
                batch.map(async type => {
                    console.log(`\n[+] Generating ${type}...`);

                    try {
                        return await generateCategory({
                            type,
                            items: profile.athenaItems,
                            apiIndex,
                            savePath,
                            assets
                        });

                    } catch (error) {
                        console.error(
                            `[!] ${type} failed: ${error.message}`
                        );

                        return {
                            success: false,
                            type,
                            error: error.message
                        };
                    }
                })
            );

            results.push(...batchResults);
        }

        console.log("\n[+] Generating account overview...");

        let overview = null;

        try {
            overview = await generateAccountOverview({
                accountId,
                profile,
                categoryResults: results,
                savePath,
                assets
            });

            console.log(
                "[+] Account overview saved."
            );

        } catch (error) {
            console.error(
                "[!] Account overview failed:",
                error.message
            );
        }

        const successful = results.filter(
            result => result.success && !result.skipped
        );

        const skipped = results.filter(
            result => result.skipped
        );

        const failed = results.filter(
            result => !result.success
        );

        const totalCosmetics = successful.reduce(
            (total, result) => total + result.count,
            0
        );

        const elapsedTime = (
            (Date.now() - startTime) / 1000
        ).toFixed(2);

        console.log("\n====================================");
        console.log("          GENERATION SUMMARY");
        console.log("====================================");

        console.log(`Generated: ${successful.length}`);
        console.log(`Skipped:   ${skipped.length}`);
        console.log(`Failed:    ${failed.length}`);
        console.log(`Cosmetics: ${totalCosmetics}`);
        console.log(`Time:      ${elapsedTime}s`);

        console.log("\nOutput directory:");
        console.log(path.resolve(savePath));

        return {
            success: failed.length === 0 && overview !== null,
            totalCategories: TYPE_ORDER.length,
            generated: successful.length,
            skipped: skipped.length,
            failed: failed.length,
            totalCosmetics,
            overview,
            time: elapsedTime,
            results
        };

    } catch (error) {
        console.error(
            "\n[ERROR] Locker generation failed:",
            error.message
        );

        return {
            success: false,
            error: error.message,
            time: (
                (Date.now() - startTime) / 1000
            ).toFixed(2)
        };
    }
}
