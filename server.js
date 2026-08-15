// ===================================
// ARIF VISA AUTO FILL PRO
// PASSPORT OCR API SERVER
// ===================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Tesseract = require("tesseract.js");

const app = express();


// ===================================
// MIDDLEWARE
// ===================================

app.use(cors());
app.use(express.json());


// ===================================
// FILE UPLOAD
// ===================================

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});


// ===================================
// TEST API
// ===================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "2.0.0",
        ocr: "READY"
    });

});


// ===================================
// PASSPORT MRZ PARSER
// ===================================

function parseMRZ(text) {

    const clean = text
        .toUpperCase()
        .replace(/[^A-Z0-9<\n]/g, "");


    const lines = clean
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length >= 30);


    let mrz1 = "";
    let mrz2 = "";


    for (let i = 0; i < lines.length; i++) {

        if (
            lines[i].startsWith("P") &&
            lines[i].length >= 40
        ) {

            mrz1 = lines[i];

            if (lines[i + 1]) {
                mrz2 = lines[i + 1];
            }

            break;
        }
    }


    if (!mrz1 || !mrz2) {

        return {
            found: false,
            name: "",
            passportNo: "",
            dob: "",
            nationality: "",
            sex: "",
            expiry: ""
        };

    }


    // ===================================
    // PASSPORT NUMBER
    // ===================================

    const passportNo =
        mrz2
            .substring(0, 9)
            .replace(/</g, "")
            .trim();


    // ===================================
    // NATIONALITY
    // ===================================

    const nationality =
        mrz2.substring(10, 13);


    // ===================================
    // DATE OF BIRTH
    // ===================================

    const dobRaw =
        mrz2.substring(13, 19);


    // ===================================
    // SEX
    // ===================================

    const sex =
        mrz2.substring(20, 21);


    // ===================================
    // EXPIRY DATE
    // ===================================

    const expiryRaw =
        mrz2.substring(21, 27);


    // ===================================
    // NAME
    // ===================================

    let name = "";

    const namePart =
        mrz1.substring(5);

    const nameSections =
        namePart.split("<<");


    if (nameSections.length > 0) {

        name =
            nameSections
                .join(" ")
                .replace(/</g, " ")
                .replace(/\s+/g, " ")
                .trim();

    }


    return {

        found: true,

        name: name,

        passportNo: passportNo,

        dob: dobRaw,

        nationality: nationality,

        sex: sex,

        expiry: expiryRaw

    };

}


// ===================================
// READ PASSPORT API
// ===================================

app.post(
    "/read-passport",
    upload.single("passport"),
    async (req, res) => {

        try {

            // ===================================
            // CHECK FILE
            // ===================================

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


            console.log(
                "File Size:",
                req.file.size
            );


            console.log(
                "File Type:",
                req.file.mimetype
            );


            // ===================================
            // OCR
            // ===================================

            console.log(
                "OCR START"
            );


            const result =
                await Tesseract.recognize(
                    req.file.buffer,
                    "eng",
                    {

                        logger: info => {

                            if (
                                info.status ===
                                "recognizing text"
                            ) {

                                console.log(
                                    `OCR Progress: ${Math.round(
                                        info.progress * 100
                                    )}%`
                                );

                            }

                        }

                    }
                );


            console.log(
                "OCR DONE"
            );


            const ocrText =
                result.data.text || "";


            console.log(
                "OCR TEXT:",
                ocrText
            );


            // ===================================
            // MRZ EXTRACTION
            // ===================================

            const passportData =
                parseMRZ(ocrText);


            // ===================================
            // RESPONSE
            // ===================================

            return res.json({

                success: true,

                message:
                    passportData.found
                        ? "Passport MRZ Extracted"
                        : "OCR Completed - MRZ Not Found",

                data: {

                    name:
                        passportData.name,

                    passportNo:
                        passportData.passportNo,

                    dob:
                        passportData.dob,

                    nationality:
                        passportData.nationality,

                    sex:
                        passportData.sex,

                    expiry:
                        passportData.expiry

                }

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
                    "Passport OCR Failed",

                error:
                    error.message

            });

        }

    }
);


// ===================================
// 404 HANDLER
// ===================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "API Endpoint Not Found"

    });

});


// ===================================
// SERVER
// ===================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `ARIF VISA API SERVER RUNNING ON PORT ${PORT}`
        );

    }
);
