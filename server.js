// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v5.1
// FULL PASSPORT OCR
// MRZ + NON-MRZ
// BANGLADESHI PASSPORT OPTIMIZED
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
        fileSize: 15 * 1024 * 1024
    }
});


// =======================================
// API STATUS
// =======================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "5.1.0",
        ocr: "READY",
        mode: "FULL PASSPORT OCR - MRZ + NON-MRZ"
    });

});


// =======================================
// CLEAN TEXT
// =======================================

function cleanText(text) {

    return String(text || "")
        .replace(/\r/g, "\n")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\t/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .replace(/\n[ ]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

}


// =======================================
// LINES
// =======================================

function getLines(text) {

    return cleanText(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


// =======================================
// NORMALIZE
// =======================================

function normalize(value) {

    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// NAME CLEAN
// =======================================

function cleanName(value) {

    return normalize(value)
        .replace(/[^A-Z .'-]/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// DATE
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    let v =
        String(value)
            .toUpperCase()
            .replace(/O/g, "0")
            .replace(/[IL]/g, "1")
            .replace(/\s+/g, " ")
            .trim();


    // DD MON YYYY

    const monthMap = {

        JAN: "01",
        FEB: "02",
        MAR: "03",
        APR: "04",
        MAY: "05",
        JUN: "06",
        JUL: "07",
        AUG: "08",
        SEP: "09",
        OCT: "10",
        NOV: "11",
        DEC: "12"

    };


    let m =
        v.match(
            /\b(\d{1,2})\s*([A-Z]{3})\s*(\d{4})\b/
        );


    if (m) {

        const day =
            m[1].padStart(2, "0");

        const month =
            monthMap[m[2]];

        if (month) {

            return `${m[3]}-${month}-${day}`;

        }

    }


    // DD/MM/YYYY

    m =
        v.match(
            /\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/
        );


    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }


    // YYYY-MM-DD

    m =
        v.match(
            /\b(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})\b/
        );


    if (m) {

        return `${m[1]}-${m[2]}-${m[3]}`;

    }


    return "";

}


// =======================================
// FIND LABEL VALUE
// =======================================

function findLabelValue(text, labels) {

    const lines =
        getLines(text);


    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i];


        for (const label of labels) {

            const regex =
                new RegExp(
                    label +
                    "\\s*[:.\\-]?\\s*(.*)$",
                    "i"
                );


            const match =
                line.match(regex);


            if (match) {

                let value =
                    normalize(match[1]);


                if (!value && lines[i + 1]) {

                    value =
                        normalize(lines[i + 1]);

                }


                if (value) {

                    return value;

                }

            }

        }

    }


    return "";

}


// =======================================
// PASSPORT NUMBER
// =======================================

function findPassportNumber(text) {

    const patterns = [

        /Passport\s*Number\s*([A-Z]\d{7,8})/i,

        /Passport\s*No\.?\s*([A-Z]\d{7,8})/i,

        /Passport\s*Number\s*[:\-]?\s*([A-Z0-9]{8,9})/i,

        /\b([A-Z]\d{7,8})\b/

    ];


    for (const pattern of patterns) {

        const m =
            text.match(pattern);


        if (m && m[1]) {

            return m[1]
                .replace(/\s/g, "")
                .toUpperCase();

        }

    }


    return "";

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const value =
        findLabelValue(
            text,
            ["Nationality"]
        );


    const v =
        value.toUpperCase();


    if (
        v.includes("BANGLADESH") ||
        v.includes("BANGLADESHI")
    ) {

        return "BGD";

    }


    if (/\bBGD\b/i.test(text)) {

        return "BGD";

    }


    return "";

}


// =======================================
// NAME
// =======================================

function findNames(text) {

    const result = {

        fullName: "",
        surname: "",
        givenName: ""

    };


    const lines =
        getLines(text);


    // ===================================
    // Surname
    // ===================================

    for (let i = 0; i < lines.length; i++) {

        if (/Surname/i.test(lines[i])) {

            let value =
                lines[i]
                    .replace(/.*Surname/i, "")
                    .replace(/[:\-]/g, "")
                    .trim();


            if (
                !value &&
                lines[i + 1]
            ) {

                value =
                    lines[i + 1];

            }


            if (value) {

                result.surname =
                    cleanName(value);

                break;

            }

        }

    }


    // ===================================
    // Given Name
    // ===================================

    for (let i = 0; i < lines.length; i++) {

        if (/Given\s*Name/i.test(lines[i])) {

            let value =
                lines[i]
                    .replace(
                        /.*Given\s*Name/i,
                        ""
                    )
                    .replace(/[:\-]/g, "")
                    .trim();


            if (
                !value &&
                lines[i + 1]
            ) {

                value =
                    lines[i + 1];

            }


            if (value) {

                result.givenName =
                    cleanName(value);

                break;

            }

        }

    }


    // ===================================
    // OCR-specific fallback
    // ===================================

    if (!result.surname) {

        const m =
            text.match(
                /Surname[\s\S]{0,100}?([A-Z]{3,})/i
            );


        if (m) {

            result.surname =
                cleanName(m[1]);

        }

    }


    if (!result.givenName) {

        const m =
            text.match(
                /Given\s*Name[\s\S]{0,100}?((?:MD|MOHAMMAD|ABDUL|MD\.)[\sA-Z]{2,})/i
            );


        if (m) {

            result.givenName =
                cleanName(m[1]);

        }

    }


    if (
        result.surname &&
        result.givenName
    ) {

        result.fullName =
            `${result.givenName} ${result.surname}`;

    }


    return result;

}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    return cleanName(
        findLabelValue(
            text,
            [
                "Father's Name",
                "Father's Mame",
                "Father Name",
                "Father"
            ]
        )
    );

}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    return cleanName(
        findLabelValue(
            text,
            [
                "Mother's Name",
                "Mother's Mame",
                "Mother Name",
                "Mother"
            ]
        )
    );

}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    return cleanName(
        findLabelValue(
            text,
            [
                "Spouse's Name",
                "Spouse's Mame",
                "Spouse Name",
                "Spouse"
            ]
        )
    );

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    return normalize(
        findLabelValue(
            text,
            [
                "Permanent Address",
                "Present Address",
                "Current Address",
                "Residential Address"
            ]
        )
    );

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNo(text) {

    const lines =
        getLines(text);


    for (let i = 0; i < lines.length; i++) {

        if (/Personal\s*No/i.test(lines[i])) {

            const after =
                lines[i]
                    .replace(
                        /.*Personal\s*No/i,
                        ""
                    )
                    .replace(/[:\-]/g, "")
                    .trim();


            const m =
                after.match(
                    /\d{8,17}/
                );


            if (m) {

                return m[0];

            }


            if (lines[i + 1]) {

                const n =
                    lines[i + 1]
                        .match(
                            /\d{8,17}/
                        );


                if (n) {

                    return n[0];

                }

            }

        }

    }


    // General fallback

    const m =
        text.match(
            /Personal\s*No[\s\S]{0,100}?(\d{8,17})/i
        );


    return m ? m[1] : "";

}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    const m =
        text.match(
            /Date\s*of\s*Birth[\s\S]{0,80}?(\d{1,2}\s*[A-Z]{3}\s*\d{4})/i
        );


    if (m) {

        return normalizeDate(m[1]);

    }


    return "";

}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    const m =
        text.match(
            /Date\s*of\s*Issue[\s\S]{0,100}?(\d{1,2}\s*[A-Z]{3}\s*\d{4})/i
        );


    if (m) {

        return normalizeDate(m[1]);

    }


    return "";

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiryDate(text) {

    const m =
        text.match(
            /Date\s*of\s*Expiry[\s\S]{0,100}?(\d{1,2}\s*[A-Z]{3}\s*\d{4})/i
        );


    if (m) {

        return normalizeDate(m[1]);

    }


    // OCR sometimes loses "Date of"

    const m2 =
        text.match(
            /Expiry[\s\S]{0,100}?(\d{1,2}\s*[A-Z]{3}\s*\d{4})/i
        );


    if (m2) {

        return normalizeDate(m2[1]);

    }


    return "";

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const m =
        text.match(
            /Sex[\s:.\-]*([MF])/i
        );


    if (m) {

        return m[1].toUpperCase();

    }


    return "";

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    const m =
        text.match(
            /Place\s*of\s*Birth[\s:.\-]*([A-Z][A-Z ]{2,})/i
        );


    if (m) {

        return cleanName(m[1]);

    }


    return "";

}


// =======================================
// ISSUE AUTHORITY
// =======================================

function findAuthority(text) {

    const m =
        text.match(
            /Issuing\s*Authority[\s:.\-]*([A-Z][A-Z ]{2,})/i
        );


    if (m) {

        return cleanName(m[1]);

    }


    return "";

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const m =
        text.match(
            /Previous\s*Passport\s*No[\s:.\-]*([A-Z0-9]+)/i
        );


    return m
        ? m[1].toUpperCase()
        : "";

}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    return normalize(
        findLabelValue(
            text,
            [
                "Profession",
                "Occupation"
            ]
        )
    );

}


// =======================================
// OCR
// =======================================

async function runOCR(buffer) {

    console.log("OCR START");

    const processed =
        await sharp(buffer)
            .rotate()
            .resize({
                width: 3000,
                withoutEnlargement: false
            })
            .grayscale()
            .normalize()
            .sharpen()
            .png()
            .toBuffer();


    const worker =
        await createWorker("eng");


    try {

        await worker.setParameters({

            tessedit_pageseg_mode: "6",

            preserve_interword_spaces: "1"

        });


        const result =
            await worker.recognize(
                processed
            );


        const text =
            result.data.text || "";


        console.log(
            "OCR DONE"
        );


        console.log(
            "========== RAW OCR =========="
        );


        console.log(text);


        console.log(
            "=============================="
        );


        return text;

    }

    finally {

        await worker.terminate();

    }

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

                    message:
                        "No Passport File"

                });

            }


            console.log(
                "Passport Received:",
                req.file.originalname
            );


            const rawText =
                await runOCR(
                    req.file.buffer
                );


            const text =
                cleanText(rawText);


            // =================================
            // EXTRACT
            // =================================

            const names =
                findNames(text);


            const data = {

                fullName:
                    names.fullName,

                surname:
                    names.surname,

                givenName:
                    names.givenName,

                passportNo:
                    findPassportNumber(text),

                nationality:
                    findNationality(text),

                dob:
                    findDOB(text),

                sex:
                    findSex(text),

                placeOfBirth:
                    findPlaceOfBirth(text),

                issueDate:
                    findIssueDate(text),

                expiryDate:
                    findExpiryDate(text),

                placeOfIssue:
                    "",

                issuingAuthority:
                    findAuthority(text),

                personalNo:
                    findPersonalNo(text),

                previousPassportNo:
                    findPreviousPassport(text),

                address:
                    findAddress(text),

                fatherName:
                    findFather(text),

                motherName:
                    findMother(text),

                spouseName:
                    findSpouse(text),

                profession:
                    findProfession(text),

                mrz:
                    []

            };


            // =================================
            // MRZ
            // =================================

            const mrzLines =
                getLines(text)
                    .map(x =>
                        x
                            .replace(/\s/g, "")
                            .toUpperCase()
                    )
                    .filter(
                        x =>
                            x.length >= 30 &&
                            /^[A-Z0-9<]+$/.test(x)
                    );


            data.mrz =
                mrzLines.slice(-2);


            // =================================
            // MRZ PASSPORT FALLBACK
            // =================================

            if (!data.passportNo) {

                const line =
                    data.mrz.find(
                        x =>
                            x.startsWith("P<") === false
                    );


                if (line) {

                    const candidate =
                        line
                            .substring(0, 9)
                            .replace(/</g, "")
                            .toUpperCase();


                    if (
                        /^[A-Z]\d{7,8}$/.test(
                            candidate
                        )
                    ) {

                        data.passportNo =
                            candidate;

                    }

                }

            }


            // =================================
            // NAME FALLBACK FROM MRZ
            // =================================

            const mrzName =
                data.mrz.find(
                    x =>
                        x.startsWith("P<")
                );


            if (
                mrzName &&
                (
                    !data.surname ||
                    !data.givenName
                )
            ) {

                const namePart =
                    mrzName
                        .substring(5)
                        .split("<<");


                const surname =
                    cleanName(
                        (namePart[0] || "")
                            .replace(/</g, " ")
                    );


                const given =
                    cleanName(
                        (namePart[1] || "")
                            .replace(/</g, " ")
                    );


                // Reject OCR filler

                if (
                    surname &&
                    !/L{5,}/.test(surname)
                ) {

                    data.surname =
                        data.surname ||
                        surname;

                }


                if (
                    given &&
                    !/L{5,}/.test(given)
                ) {

                    data.givenName =
                        data.givenName ||
                        given;

                }


                if (
                    !data.fullName &&
                    (
                        data.surname ||
                        data.givenName
                    )
                ) {

                    data.fullName =
                        `${data.givenName || ""} ${data.surname || ""}`
                            .trim();

                }

            }


            // =================================
            // FINAL NAME FALLBACK
            // =================================

            if (
                !data.fullName &&
                (
                    data.givenName ||
                    data.surname
                )
            ) {

                data.fullName =
                    `${data.givenName || ""} ${data.surname || ""}`
                        .trim();

            }


            // =================================
            // FINAL NATIONALITY
            // =================================

            if (!data.nationality) {

                if (
                    /BANGLADESH/i.test(text) ||
                    /BANGLADESHI/i.test(text)
                ) {

                    data.nationality =
                        "BGD";

                }

            }


            // =================================
            // DEBUG
            // =================================

            console.log(
                "================================="
            );


            console.log(
                "FULL EXTRACTED DATA:"
            );


            console.log(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );


            console.log(
                "================================="
            );


            return res.json({

                success: true,

                message:
                    "Full Passport OCR completed",

                version:
                    "5.1.0",

                mode:
                    "FULL MRZ + NON-MRZ",

                data:
                    data,

                rawText:
                    rawText

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
            `ARIF VISA API SERVER v5.1 RUNNING ON PORT ${PORT}`
        );

    }
);
