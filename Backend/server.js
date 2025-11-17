import express from "express";
import multer from "multer";
import cors from "cors";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { exec } from "child_process";
import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ======= CORS SETUP =======
// Allow your local frontend and deployed frontend
const allowedOrigins = [
    "http://localhost:5000",
    "http://127.0.0.1:5500",
    "https://pdf.olivez.in" // <-- replace with your domain
];

app.use(cors({
    origin: ["https://pdf.olivez.in"]
}));

app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// ======= MONGODB SETUP =======
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.log(err));

const FileSchema = new mongoose.Schema({
    originalName: String,
    type: String,
    createdAt: { type: Date, default: Date.now }
});
const File = mongoose.model("File", FileSchema);

// ======= PORT =======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ======= ROUTES =======

// 1️⃣ Images → PDF
app.post("/to-pdf/images", upload.array("files"), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.create();
        for (const file of req.files) {
            const image = sharp(file.buffer);
            const { width, height } = await image.metadata();
            const imgBuffer = await image.jpeg().toBuffer();
            const jpgImage = await pdfDoc.embedJpg(imgBuffer);
            const page = pdfDoc.addPage([width, height]);
            page.drawImage(jpgImage, { x: 0, y: 0, width, height });
            await File.create({ originalName: file.originalname, type: "image" });
        }
        const pdfBytes = await pdfDoc.save();
        res.setHeader("Content-Type", "application/pdf");
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to convert images to PDF");
    }
});

// 2️⃣ DOCX → PDF
app.post("/to-pdf/docx", upload.single("file"), async (req, res) => {
    const inputPath = "./temp.docx";
    const outputPath = "./temp.pdf";
    try {
        fs.writeFileSync(inputPath, req.file.buffer);
        exec(`soffice --headless --convert-to pdf ${inputPath} --outdir .`, async (err) => {
            if (err) return res.status(500).send("LibreOffice conversion error");
            const pdfBuffer = fs.readFileSync(outputPath);
            res.setHeader("Content-Type", "application/pdf");
            res.send(pdfBuffer);
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
            await File.create({ originalName: req.file.originalname, type: "docx" });
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error processing DOCX file");
    }
});

// 3️⃣ PDF → Text
app.post("/from-pdf/text", upload.single("file"), async (req, res) => {
    const pdfPath = "./temp.pdf";
    fs.writeFileSync(pdfPath, req.file.buffer);
    exec(`pdftotext ${pdfPath} -`, (err, stdout) => {
        fs.unlinkSync(pdfPath);
        if (err) return res.status(500).send("Failed to extract text from PDF");
        res.send(stdout);
    });
});

// 4️⃣ PDF → Images (PNG)
app.post("/from-pdf/images", upload.single("file"), async (req, res) => {
    const pdfPath = "./temp.pdf";
    fs.writeFileSync(pdfPath, req.file.buffer);
    exec(`pdftoppm ${pdfPath} output -png`, async (err) => {
        if (err) {
            fs.unlinkSync(pdfPath);
            return res.status(500).send("Failed to extract images from PDF");
        }
        const files = fs.readdirSync(".").filter(f => f.startsWith("output"));
        const images = files.map(name => ({
            name,
            data: fs.readFileSync(name).toString("base64")
        }));
        files.forEach(f => fs.unlinkSync(f));
        fs.unlinkSync(pdfPath);
        res.json(images);
    });
});
