// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v6.0
// SMART FULL PASSPORT OCR
// MRZ + NON-MRZ
// =======================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const app = express();

app.use(cors());
app.use(express.json());


// =======================================
// UPLOAD
// =======================================

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

        version: "6.0.0",

        ocr: "READY",

        mode: "SMART MRZ + NON-MRZ PASSPORT OCR"

    });

});


// =======================================
// TEXT CLEAN
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
// NORMALIZE
// =======================================

function normalizeText(value) {

    return String(value || "")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// CLEAN FIELD
// =======================================

function cleanField(value) {

    if (!value) return "";

    let v =
        normalizeText(value);

    v = v
        .replace(/[|]/g, "I")
        .replace(/^[\s:;,\-—–]+/, "")
        .replace(/[\s—–]+$/, "")
        .trim();

    if (!v) return "";

    if (/^[-—–]+$/.test(v)) {
        return "";
    }

    if (/^S\s*[-—–]*$/i.test(v)) {
        return "";
    }

    if (/^N$/i.test(v)) {
        return "";
    }

    if (/^CR$/i.test(v)) {
        return "";
    }

    return v;

}


// =======================================
// CLEAN NAME
// =======================================

function cleanName(value) {

    let v =
        cleanField(value);

    if (!v) return "";

    v = v
        .replace(/[^A-Z .'-]/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    if (!v) return "";

    if (/^S\s*[-—–]*$/i.test(v)) {
        return "";
    }

    if (/^N$/i.test(v)) {
        return "";
    }

    if (/^CR$/i.test(v)) {
        return "";
    }

    return v;

}


// =======================================
// OCR LINES
// =======================================

function getOCRLines(text) {

    return String(text || "")
        .replace(/\r/g, "\n")
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


// =======================================
// SAME LINE FIELD
// =======================================

function sameLineField(
    text,
    patterns,
    cleaner = cleanField
) {

    const lines =
        getOCRLines(text);

    for (const line of lines) {

        for (const pattern of patterns) {

            const regex =
                new RegExp(
                    pattern +
                    "\\s*[:.\\-]?\\s*(.+)$",
                    "i"
                );

            const match =
                line.match(regex);

            if (
                match &&
                match[1]
            ) {

                const value =
                    cleaner(match[1]);

                if (value) {
                    return value;
                }

            }

        }

    }

    return "";

}


// =======================================
// NEARBY FIELD
// IMPORTANT: DOES NOT CROSS NEXT FIELD
// =======================================

function nearbyField(
    text,
    patterns,
    cleaner = cleanField
) {

    const lines =
        getOCRLines(text);


    const fieldPatterns = [

        /Father.?s?\s+(?:Name|Mame)/i,

        /Mother.?s?\s+(?:Name|Mame)/i,

        /Spouse.?s?\s+(?:Name|Mame)/i,

        /Permanent\s+Address/i,

        /Present\s+Address/i,

        /Current\s+Address/i,

        /Residential\s+Address/i,

        /Emergency\s+Contact/i,

        /Relationship/i,

        /Telephone\s+No/i,

        /Date\s+of\s+Birth/i,

        /Date\s+of\s+Issue/i,

        /Date\s+of\s+Expiry/i,

        /Place\s+of\s+Birth/i,

        /Issuing\s+Authority/i,

        /Previous\s+Passport/i,

        /Profession/i,

        /Occupation/i

    ];


    for (let i = 0; i < lines.length; i++) {

        let matched = false;

        for (const pattern of patterns) {

            if (
                new RegExp(
                    pattern,
                    "i"
                ).test(lines[i])
            ) {

                matched = true;
                break;

            }

        }


        if (!matched) {
            continue;
        }


        // ===================================
        // SAME LINE
        // ===================================

        for (const pattern of patterns) {

            const regex =
                new RegExp(
                    pattern +
                    "\\s*[:.\\-]?\\s*(.+)$",
                    "i"
                );

            const match =
                lines[i].match(regex);

            if (
                match &&
                match[1]
            ) {

                const value =
                    cleaner(match[1]);

                if (value) {
                    return value;
                }

            }

        }


        // ===================================
        // NEXT LINE
        // BUT STOP AT NEXT FIELD
        // ===================================

        for (
            let j = i + 1;
            j <= Math.min(i + 2, lines.length - 1);
            j++
        ) {

            const next =
                lines[j];


            let isAnotherField = false;


            for (const fp of fieldPatterns) {

                if (fp.test(next)) {

                    isAnotherField = true;
                    break;

                }

            }


            if (isAnotherField) {
                break;
            }


            const value =
                cleaner(next);


            if (value) {
                return value;
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

        /Passport\s*Number[\s:.\-]*(A\d{7,8})/i,

        /Passport\s*No[\s:.\-]*(A\d{7,8})/i,

        /Passport\s*Number[\s\S]{0,120}?\b(A\d{7,8})\b/i,

        /\b(A\d{7,8})\b/

    ];


    for (const pattern of patterns) {

        const match =
            text.match(pattern);

        if (
            match &&
            match[1]
        ) {

            return match[1]
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

    const upper =
        text.toUpperCase();

    if (
        upper.includes("BANGLADESH") ||
        upper.includes("BANGLADESHI") ||
        /\bBGD\b/.test(upper)
    ) {

        return "BGD";

    }

    return "";

}


// =======================================
// NAME FROM PASSPORT VISUAL TEXT
// =======================================

function findNames(text) {

    const lines =
        getOCRLines(text);


    let surname = "";

    let givenName = "";


    // ===================================
    // SURNAME
    // ===================================

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            /Surname/i.test(lines[i])
        ) {

            let value =
                lines[i]
                    .replace(
                        /.*Surname/i,
                        ""
                    )
                    .replace(
                        /^[:.\-]+/,
                        ""
                    )
                    .trim();


            if (!value) {

                for (
                    let j = i + 1;
                    j <= Math.min(
                        i + 3,
                        lines.length - 1
                    );
                    j++
                ) {

                    if (
                        /Given\s*Name/i.test(
                            lines[j]
                        )
                    ) {
                        break;
                    }


                    const candidate =
                        cleanName(lines[j]);


                    if (
                        candidate &&
                        candidate.length > 2
                    ) {

                        value =
                            candidate;

                        break;

                    }

                }

            }


            value =
                cleanName(value);


            if (
                value &&
                !/L{5,}/i.test(value)
            ) {

                surname =
                    value;

                break;

            }

        }

    }


    // ===================================
    // GIVEN NAME
    // ===================================

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            /Given\s*Name/i.test(
                lines[i]
            )
        ) {

            let value =
                lines[i]
                    .replace(
                        /.*Given\s*Name/i,
                        ""
                    )
                    .replace(
                        /^[:.\-]+/,
                        ""
                    )
                    .trim();


            if (!value) {

                for (
                    let j = i + 1;
                    j <= Math.min(
                        i + 3,
                        lines.length - 1
                    );
                    j++
                ) {

                    const candidate =
                        cleanName(lines[j]);


                    if (
                        candidate &&
                        candidate.length > 2 &&
                        !/Surname/i.test(lines[j])
                    ) {

                        value =
                            candidate;

                        break;

                    }

                }

            }


            value =
                cleanName(value);


            if (
                value &&
                !/L{5,}/i.test(value)
            ) {

                givenName =
                    value;

                break;

            }

        }

    }


    return {

        surname,

        givenName,

        fullName:
            `${givenName} ${surname}`
                .trim()

    };

}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    return nearbyField(

        text,

        [
            "Father's\\s+Name",
            "Father's\\s+Mame",
            "Father\\s+Name"
        ],

        cleanName

    );

}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    return nearbyField(

        text,

        [
            "Mother's\\s+Name",
            "Mother's\\s+Mame",
            "Mother\\s+Name"
        ],

        cleanName

    );

}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    return nearbyField(

        text,

        [
            "Spouse's\\s+Name",
            "Spouse's\\s+Mame",
            "Spouse\\s+Name"
        ],

        cleanName

    );

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    return nearbyField(

        text,

        [
            "Permanent\\s+Address",
            "Present\\s+Address",
            "Current\\s+Address",
            "Residential\\s+Address"
        ],

        cleanField

    );

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNo(text) {

    const patterns = [

        /Personal\s*No[\s\S]{0,120}?(\d{10,17})/i,

        /Personal\s*Number[\s\S]{0,120}?(\d{10,17})/i

    ];


    for (const pattern of patterns) {

        const match =
            text.match(pattern);

        if (
            match &&
            match[1]
        ) {

            return match[1];

        }

    }


    return "";

}


// =======================================
// DATE NORMALIZER
// =======================================

function normalizeDate(value) {

    if (!value) {
        return "";
    }


    let v =
        String(value)
            .toUpperCase()
            .replace(/\s+/g, "")
            .trim();


    // OCR corrections

    v =
        v
            .replace(/0CT/g, "OCT")
            .replace(/0CT/g, "OCT");


    const months = {

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


    let match =
        v.match(
            /^(\d{1,2})([A-Z]{3})(\d{4})$/
        );


    if (
        match &&
        months[match[2]]
    ) {

        return (
            `${match[3]}-${months[match[2]]}-${match[1].padStart(2, "0")}`
        );

    }


    match =
        v.match(
            /^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/
        );


    if (match) {

        return (
            `${match[3]}-${match[2]}-${match[1]}`
        );

    }


    match =
        v.match(
            /^(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})$/
        );


    if (match) {

        return (
            `${match[1]}-${match[2]}-${match[3]}`
        );

    }


    return "";

}


// =======================================
// DATE SEARCH
// =======================================

function findDateAfterLabel(
    text,
    label
) {

    const lines =
        getOCRLines(text);


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            new RegExp(
                label,
                "i"
            ).test(lines[i])
        ) {

            // Same line

            const same =
                lines[i].match(
                    /(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
                );


            if (same) {

                const result =
                    normalizeDate(
                        same[1]
                    );

                if (result) {
                    return result;
                }

            }


            // Next line

            for (
                let j = i + 1;
                j <= Math.min(
                    i + 2,
                    lines.length - 1
                );
                j++
            ) {

                const match =
                    lines[j].match(
                        /(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
                    );


                if (match) {

                    const result =
                        normalizeDate(
                            match[1]
                        );

                    if (result) {
                        return result;
                    }

                }

            }

        }

    }


    return "";

}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    return findDateAfterLabel(
        text,
        "Date\\s*of\\s*Birth"
    );

}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    return findDateAfterLabel(
        text,
        "Date\\s*of\\s*Issue"
    );

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiryDate(text) {

    return findDateAfterLabel(
        text,
        "Date\\s*of\\s*Expiry"
    );

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const lines =
        getOCRLines(text);


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            /\bSex\b/i.test(
                lines[i]
            )
        ) {

            const same =
                lines[i].match(
                    /\bSex\b[\s:.\-]*([MF])\b/i
                );


            if (same) {
                return same[1]
                    .toUpperCase();
            }


            for (
                let j = i + 1;
                j <= Math.min(
                    i + 2,
                    lines.length - 1
                );
                j++
            ) {

                const m =
                    lines[j].match(
                        /^\s*([MF])\s*$/i
                    );


                if (m) {

                    return m[1]
                        .toUpperCase();

                }

            }

        }

    }


    // OCR often puts sex as a single M/F
    // around the visual passport area.

    const fallback =
        text.match(
            /\bSex\b[\s\S]{0,80}?\b([MF])\b/i
        );


    return fallback
        ? fallback[1].toUpperCase()
        : "";

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    const lines =
        getOCRLines(text);


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            /Place\s+of\s+Birth/i.test(
                lines[i]
            )
        ) {

            const same =
                lines[i].match(
                    /Place\s+of\s+Birth\s*[:.\-]?\s*([A-Z][A-Z ]{2,})/i
                );


            if (same) {

                const value =
                    cleanName(
                        same[1]
                    );

                if (value) {
                    return value;
                }

            }


            for (
                let j = i + 1;
                j <= Math.min(
                    i + 2,
                    lines.length - 1
                );
                j++
            ) {

                const value =
                    cleanName(
                        lines[j]
                    );


                if (
                    value &&
                    !/Date|Issue|Expiry|Authority/i.test(
                        lines[j]
                    )
                ) {

                    return value;

                }

            }

        }

    }


    return "";

}


// =======================================
// ISSUING AUTHORITY
// =======================================

function findAuthority(text) {

    const lines =
        getOCRLines(text);


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        if (
            /Issuing\s+Authority/i.test(
                lines[i]
            )
        ) {

            const same =
                lines[i].match(
                    /Issuing\s+Authority\s*[:.\-]?\s*([A-Z][A-Z ]{2,})/i
                );


            if (same) {

                const value =
                    cleanName(
                        same[1]
                    );

                if (value) {
                    return value;
                }

            }


            for (
                let j = i + 1;
                j <= Math.min(
                    i + 2,
                    lines.length - 1
                );
                j++
            ) {

                const value =
                    cleanName(
                        lines[j]
                    );


                if (
                    value &&
                    !/Date|Expiry|Signature/i.test(
                        lines[j]
                    )
                ) {

                    return value;

                }

            }

        }

    }


    // Specific common OCR layout
    const dipi =
        text.match(
            /\b(DIP[ID]HAKA)\b/i
        );


    if (dipi) {
        return dipi[1]
            .toUpperCase();
    }


    return "";

}


// =======================================
// PLACE OF ISSUE
// =======================================

function findPlaceOfIssue(text) {

    const value =
        sameLineField(

            text,

            [
                "Place\\s+of\\s+Issue",
                "Issuing\\s+Place"
            ],

            cleanName

        );


    return value;

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const m =
        text.match(
            /Previous\s*Passport\s*No[\s:.\-]*([A-Z0-9]+)/i
        );


    if (
        m &&
        m[1]
    ) {

        return m[1]
            .toUpperCase();

    }


    return "";

}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    return nearbyField(

        text,

        [
            "Profession",
            "Occupation"
        ],

        cleanField

    );

}


// =======================================
// MRZ
// =======================================

function findMRZ(text) {

    const lines =
        getOCRLines(text);


    const possible =
        lines
            .map(line =>
                line
                    .replace(/\s/g, "")
                    .toUpperCase()
            )
            .filter(line => {

                return (
                    line.length >= 30 &&
                    /^[A-Z0-9<]+$/.test(line)
                );

            });


    const mrz = [];


    for (
        let i = 0;
        i < possible.length;
        i++
    ) {

        const line =
            possible[i];


        if (
            /^P<[A-Z]{3}/.test(line)
        ) {

            mrz.push(line);


            if (
                possible[i + 1] &&
                /^[A-Z0-9<]{35,44}$/.test(
                    possible[i + 1]
                )
            ) {

                mrz.push(
                    possible[i + 1]
                );

            }

            break;

        }

    }


    return mrz;

}


// =======================================
// MRZ PARSER
// =======================================

function parseMRZ(mrz) {

    if (
        !mrz ||
        mrz.length < 2
    ) {

        return {

            passportNo: "",
            nationality: "",
            dob: "",
            sex: "",
            expiryDate: "",
            surname: "",
            givenName: "",
            fullName: ""

        };

    }


    const line1 =
        mrz[0];

    const line2 =
        mrz[1];


    // ===================================
    // LINE 1
    // ===================================

    let surname = "";

    let givenName = "";


    if (
        line1.startsWith("P<")
    ) {

        const namePart =
            line1
                .substring(5);


        const nameParts =
            namePart.split("<<");


        surname =
            (nameParts[0] || "")
                .replace(/<+/g, " ")
                .trim();


        givenName =
            (nameParts[1] || "")
                .replace(/<+/g, " ")
                .trim();


        surname =
            cleanName(surname);


        givenName =
            cleanName(givenName);

    }


    // ===================================
    // LINE 2
    // ===================================

    // Passport number:
    // positions 0-8
    //
    // Nationality:
    // positions 10-12
    //
    // DOB:
    // positions 13-18
    //
    // Sex:
    // position 20
    //
    // Expiry:
    // positions 21-26

    let passportNo =
        line2
            .substring(0, 9)
            .replace(/</g, "")
            .toUpperCase();


    let nationality =
        line2
            .substring(10, 13)
            .replace(/</g, "")
            .toUpperCase();


    let dobRaw =
        line2
            .substring(13, 19);


    let sex =
        line2
            .substring(20, 21)
            .toUpperCase();


    let expiryRaw =
        line2
            .substring(21, 27);


    // ===================================
    // PASSPORT NUMBER VALIDATION
    // ===================================

    passportNo =
        passportNo
            .replace(/O/g, "0")
            .replace(/I/g, "1");


    // Bangladesh passport usually A + 7 digits
    const validPassport =
        /^[A-Z]\d{7,8}$/.test(
            passportNo
        );


    if (!validPassport) {

        passportNo = "";

    }


    // ===================================
    // DATE FROM MRZ
    // ===================================

    function mrzDate(raw) {

        if (
            !/^\d{6}$/.test(raw)
        ) {
            return "";
        }


        const yy =
            raw.substring(0, 2);

        const mm =
            raw.substring(2, 4);

        const dd =
            raw.substring(4, 6);


        let year =
            parseInt(yy, 10);


        // Passport DOB/expiry range
        // reasonable century handling

        if (year >= 0 && year <= 30) {
            year += 2000;
        }
        else {
            year += 1900;
        }


        return (
            `${year}-${mm}-${dd}`
        );

    }


    const dob =
        mrzDate(
            dobRaw
        );


    const expiryDate =
        mrzDate(
            expiryRaw
        );


    if (
        sex !== "M" &&
        sex !== "F"
    ) {

        sex = "";

    }


    if (
        !/^[A-Z]{3}$/.test(
            nationality
        )
    ) {

        nationality = "";

    }


    return {

        passportNo,

        nationality,

        dob,

        sex,

        expiryDate,

        surname,

        givenName,

        fullName:
            `${givenName} ${surname}`
                .trim()

    };

}


// =======================================
// OCR
// =======================================

async function runOCR(buffer) {

    console.log(
        "OCR START"
    );


    const processed =
        await sharp(buffer)
            .rotate()
            .resize({

                width: 2400,

                withoutEnlargement: false

            })
            .grayscale()
            .normalize()
            .sharpen()
            .png()
            .toBuffer();


    const worker =
        await createWorker(
            "eng"
        );


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


    await worker.terminate();


    console.log(
        "OCR DONE"
    );


    console.log(
        text
    );


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

                    message:
                        "No Passport File"

                });

            }


            console.log(
                "================================="
            );


            console.log(
                "Passport Received:",
                req.file.originalname
            );


            console.log(
                "================================="
            );


            // =================================
            // OCR
            // =================================

            const rawText =
                await runOCR(
                    req.file.buffer
                );


            const text =
                cleanText(
                    rawText
                );


            // =================================
            // MRZ
            // =================================

            const mrz =
                findMRZ(
                    text
                );


            console.log(
                "MRZ LINES:",
                mrz
            );


            const mrzData =
                parseMRZ(
                    mrz
                );


            console.log(
                "MRZ DATA:",
                mrzData
            );


            // =================================
            // VISUAL NAME
            // =================================

            const names =
                findNames(
                    text
                );


            // =================================
            // VISUAL DATA
            // =================================

            const visualPassportNo =
                findPassportNumber(
                    text
                );


            const visualNationality =
                findNationality(
                    text
                );


            const visualDOB =
                findDOB(
                    text
                );


            const visualSex =
                findSex(
                    text
                );


            const visualExpiry =
                findExpiryDate(
                    text
                );


            const visualIssue =
                findIssueDate(
                    text
                );


            const visualPlaceBirth =
                findPlaceOfBirth(
                    text
                );


            const visualAuthority =
                findAuthority(
                    text
                );


            const visualPlaceIssue =
                findPlaceOfIssue(
                    text
                );


            const fatherName =
                findFather(
                    text
                );


            const motherName =
                findMother(
                    text
                );


            const spouseName =
                findSpouse(
                    text
                );


            const address =
                findAddress(
                    text
                );


            const personalNo =
                findPersonalNo(
                    text
                );


            const previousPassportNo =
                findPreviousPassport(
                    text
                );


            const profession =
                findProfession(
                    text
                );


            // =================================
            // FINAL DATA
            // MRZ HAS PRIORITY FOR CORE FIELDS
            // =================================

            const finalPassportNo =
                mrzData.passportNo ||
                visualPassportNo ||
                "";


            const finalNationality =
                mrzData.nationality ||
                visualNationality ||
                "";


            const finalDOB =
                mrzData.dob ||
                visualDOB ||
                "";


            const finalSex =
                mrzData.sex ||
                visualSex ||
                "";


            const finalExpiry =
                mrzData.expiryDate ||
                visualExpiry ||
                "";


            const finalSurname =
                names.surname ||
                mrzData.surname ||
                "";


            const finalGivenName =
                names.givenName ||
                mrzData.givenName ||
                "";


            const finalFullName =
                `${finalGivenName} ${finalSurname}`
                    .trim() ||
                mrzData.fullName ||
                "";


            // =================================
            // FULL DATA
            // =================================

            const data = {

                fullName:
                    finalFullName,

                surname:
                    finalSurname,

                givenName:
                    finalGivenName,

                passportNo:
                    finalPassportNo,

                nationality:
                    finalNationality,

                dob:
                    finalDOB,

                sex:
                    finalSex,

                placeOfBirth:
                    visualPlaceBirth,

                issueDate:
                    visualIssue,

                expiryDate:
                    finalExpiry,

                placeOfIssue:
                    visualPlaceIssue,

                issuingAuthority:
                    visualAuthority,

                personalNo:
                    personalNo,

                previousPassportNo:
                    previousPassportNo,

                address:
                    address,

                fatherName:
                    fatherName,

                motherName:
                    motherName,

                spouseName:
                    spouseName,

                profession:
                    profession,

                mrz:
                    mrz

            };


            console.log(
                "================================="
            );


            console.log(
                "FINAL EXTRACTED DATA:"
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
                    "Smart Passport OCR completed",

                version:
                    "6.0.0",

                mode:
                    "SMART MRZ + NON-MRZ",

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
// 404
// =======================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API endpoint not found"

        });

    }
);


// =======================================
// SERVER
// =======================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ARIF VISA API SERVER v6.0 RUNNING ON PORT ${PORT}`
        );

    }
);
