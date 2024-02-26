import express from "express";
import cors from "cors";
import multer from "multer";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const db = new pg.Client({
  database: "seller",
  host: "localhost",
  user: "postgres",
  password: "Vl@d2203",
  port: 5432,
});

// MIDDLEWARE
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
  },
});

const upload = multer({ storage: storage });

// connect to db
db.connect();

app.get("/products", async (req, res) => {
  try {
    const response = await db.query("SELECT * FROM products ORDER BY id");

    res.json({ products: response.rows, count: response.rowCount });
  } catch (error) {}
});

app.get("/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const views = await db.query("UPDATE products SET views = (SELECT views FROM products WHERE id = $1) + 1 WHERE id = $2 RETURNING views", [id, id]);
    const response = await db.query("SELECT * FROM products WHERE id = $1", [id]);
    res.json({ product: response.rows[0], views: views.rows[0] });
  } catch (error) {}
});

app.post("/listing", upload.array("file", 4), async (req, res) => {
  try {
    const { title, description, category, used, price, negociable } = req.body;

    const response = await db.query("INSERT INTO products (title, description, category, new, images, price, negociable) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [title, description, category, used ? true : false, req.files.map((item) => item.filename), price, negociable ? true : false]);
    res.send("Listing created succesfully");
  } catch (error) {
    console.error("Error while creating listing:", error);
    res.status(500).send("Internal Server Error");
  }
});

const port = 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}.`);
});
