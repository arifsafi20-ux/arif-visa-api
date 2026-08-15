// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v3.0
// NON-MRZ PASSPORT OCR
// =======================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});


// =======================================
// HOME / STATUS
// =======================================

app.get("/", (req, res) => {

    res.json({

        status: "ARIF VISA API RUNNING",

        version: "3.0.0",

        ocr: "READY",

        mode: "NON-MRZ + MRZ"

    });

});


// =======================================
// CLEAN OCR TEXT
// =======================================

function cleanText(text) {

    return text
        .replace(/\r/g, "\n")
        .replace(/[|]/g, "I")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();

}


// =======================================
// NORMALIZE FIELD
// =======================================

function normalize(value) {

    if (!value) return "";

    return value
        .replace(/[^A-Z0-9 .,'-]/gi, "")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// PASSPORT NUMBER
// =======================================

function findPassportNumber(text) {

    const patterns = [

        /PASSPORT\s*(?:NO|NUMBER)?\s*[:\-]?\s*([A-Z][A-Z0-9]{6,9})/i,

        /DOCUMENT\s*(?:NO|NUMBER)?\s*[:\-]?\s*([A-Z][A-Z0-9]{6,9})/i,

        /\b([A-Z][0-9]{7,8})\b/

    ];

    for (const pattern of patterns) {

        const match = text.match(pattern);

        if (match && match[1]) {

            return match[1]
                .replace(/\s/g, "")
                .toUpperCase();

        }

    }

    return "";

}


// =======================================
// DATE FINDER
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    value = value
        .replace(/[OQ]/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/[SZ]/g, "5")
        .replace(/[B]/g, "8")
        .trim();

    let m;

    m = value.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }

    m = value.match(/^(\d{2})(\d{2})(\d{4})$/);

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }

    m = value.match(/^(\d{4})[\/\-.](\d{2})[\/\-.](\d{2})$/);

    if (m) {

        return `${m[1]}-${m[2]}-${m[3]}`;

    }

    return "";

}


// =======================================
// DATE OF BIRTH
// =======================================

function findDOB(text) {

    const patterns = [

        /DATE\s*OF\s*BIRTH\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i,

        /DOB\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i,

        /BIRTH\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i

    ];

    for (const pattern of patterns) {

        const match = text.match(pattern);

        if (match) {

            const date = normalizeDate(match[1]);

            if (date) return date;

        }

    }

    return "";

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiry(text) {

    const patterns = [

        /DATE\s*OF\s*EXPIRY\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i,

        /EXPIRY\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i,

        /EXPIRATION\s*[:\-]?\s*([0-9OQILSZB\/\-. ]{8,12})/i

    ];

    for (const pattern of patterns) {

        const match = text.match(pattern);

        if (match) {

            const date = normalizeDate(match[1]);

            if (date) return date;

        }

    }

    return "";

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const upper = text.toUpperCase();

    if (
        upper.includes("BANGLADESH") ||
        upper.includes("BGD")
    ) {

        return "BGD";

    }

    const match = upper.match(
        /NATIONALITY\s*[:\-]?\s*([A-Z]{3})/
    );

    if (match) {

        return match[1];

    }

    return "";

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const upper = text.toUpperCase();

    const match = upper.match(
        /(?:SEX|GENDER)\s*[:\-]?\s*([MF])/ 
    );

    if (match) {

        return match[1];

    }

    if (
        /\bFEMALE\b/.test(upper) ||
        /\bF\b/.test(upper)
    ) {

        return "F";

    }

    if (
        /\bMALE\b/.test(upper) ||
        /\bM\b/.test(upper)
    ) {

        return "M";

    }

    return "";

}


// =======================================
// NAME
// =======================================

function findName(text) {

    const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 2);

    const labels = [

        "SURNAME",

        "GIVEN NAMES",

        "GIVEN NAME",

        "NAME"

    ];

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            if (
                line.toUpperCase().startsWith(label)
            ) {

                let value = line
                    .substring(label.length)
                    .replace(/^[:\-]/, "")
                    .trim();

                if (!value && lines[i + 1]) {

                    value = lines[i + 1];

                }

                value = normalize(value);

                if (
                    value.length >= 3 &&
                    /[A-Z]/i.test(value)
                ) {

                    return value.toUpperCase();

                }

            }

        }

    }


    // fallback:
    // look for long alphabetic lines

    for (const line of lines) {

        const cleaned = normalize(line);

        if (
            cleaned.length >= 8 &&
            cleaned.length <= 50 &&
            /^[A-Z .'-]+$/i.test(cleaned) &&
            !/PASSPORT|BANGLADESH|NATIONALITY|DATE|BIRTH|EXPIRY|SEX|MALE|FEMALE/i.test(cleaned)
        ) {

            return cleaned.toUpperCase();

        }

    }

    return "";

}


// =======================================
// OCR EXTRACTION
// =======================================

async function runOCR(buffer) {

    console.log("OCR START");

    const processed = await sharp(buffer)
        .rotate()
        .resize({
            width: 2200,
            withoutEnlargement: false
        })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();


    const worker = await createWorker("eng", 1, {

        logger: message => {

            if (message.status) {

                console.log(
                    "OCR:",
                    message.status,
                    message.progress
                        ? Math.round(message.progress * 100) + "%"
                        : ""
                );

            }

        }

    });


    await worker.setParameters({

        tessedit_pageseg_mode: "6"

    });


    const result = await worker.recognize(processed);

    const text = result.data.text || "";

    await worker.terminate();

    console.log("OCR DONE");

    console.log(text);

    return text;

}


// =======================================
// READ PASSPORT
// =======================================

app.post(
    "/read-passport",
    upload.single("passport"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    message: "No Passport File"

                });

            }


            console.log(
                "Passport Received:",
                req.file.originalname
            );


            const rawText = await runOCR(
                req.file.buffer
            );


            const text = cleanText(rawText);


            const data = {

                name: findName(text),

                passportNo:
                    findPassportNumber(text),

                dob:
                    findDOB(text),

                nationality:
                    findNationality(text),

                sex:
                    findSex(text),

                expiry:
                    findExpiry(text)

            };


            console.log(
                "EXTRACTED DATA:",
                data
            );


            return res.json({

                success: true,

                message:
                    "Passport OCR completed",

                mode:
                    "NON-MRZ + MRZ",

                data: data,

                rawText: rawText

            });

        }

        catch (error) {

            console.error(
                "PASSPORT OCR ERROR:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "OCR Failed",

                error:
                    error.message

            });

        }

    }
);


// =======================================
// START SERVER
// =======================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ARIF VISA API SERVER RUNNING ON PORT ${PORT}`
        );

    }
);
