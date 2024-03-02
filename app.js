import express from "express";
import cors from "cors";
import multer from "multer";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import bcrypt from "bcrypt";
import passport from "passport";
import LocalStrategy from "passport-local";
import jwt from "jsonwebtoken";
import passportJWT from "passport-jwt";
import dotenv from "dotenv";
import { log } from "console";
dotenv.config();

const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const saltRounds = 10;

const app = express();

const db = new pg.Client({
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// MIDDLEWARE
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(passport.initialize());

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

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const checkUser = await db.query("SELECT * FROM users WHERE username = $1", [username]);

    if (checkUser.rows.length > 0) {
      return res.status(400).send("Username already exists");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Error hashing password");
        } else {
          try {
            const result = await db.query("INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *", [username, hash]);
            console.log(result.rows[0]);
            res.send("Registered");
          } catch (error) {
            console.error("Registration error:", error);
            res.status(500).send("Registration failed. Please try again.");
          }
        }
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/login", passport.authenticate("local", { session: false }), async (req, res) => {
  const user = req.user;

  try {
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    res.json({ id: user.id, username: user.username, createdAt: user.registration_date, token });
  } catch (error) {
    console.error("Error signing JWT:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

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
    const response = await db.query("SELECT products.id, title, description, new, category, images, date, price, negociable,user_id, username, registration_date FROM products JOIN users ON users.id = products.user_id WHERE products.id = $1", [id]);
    res.json({ product: response.rows[0], views: views.rows[0] });
  } catch (error) {}
});

app.delete("/products/:id", async (req, res) => {
  const id = req.params.id;
  console.log(req.params);
  try {
    await db.query("DELETE FROM products WHERE id = $1", [id]);
    res.send("Listing deleted");
  } catch (error) {
    console.error(error);
    res.status(500).send("Listing could not be deleted try again...");
  }
});

app.post("/listing", upload.array("file", 4), async (req, res) => {
  try {
    const { title, description, category, used, price, negociable, userId } = req.body;
    await db.query("INSERT INTO products (title, description, category, new, images, price, negociable, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ", [title, description, category, used ? true : false, req.files.map((item) => item.filename), price, negociable ? true : false, userId]);
    res.send("Listing created succesfully");
  } catch (error) {
    console.error("Error while creating listing:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/listing/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const response = await db.query("SELECT products.id, title, description, new, category, images, price, negociable,user_id FROM products JOIN users ON users.id = products.user_id WHERE products.id = $1", [id]);
    res.json(response.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

app.patch("/listing/:id", upload.array("file", 4), async (req, res) => {
  const id = req.params.id;
  const { title, category, used, description, price, negociable } = req.body;
  try {
    const oldImages = await db.query("SELECT images FROM products WHERE id = $1", [id]);
    await db.query("UPDATE products SET title = $1, category = $2, new = $3, description = $4, images = $5, price= $6, negociable = $7 WHERE id = $8", [title, category, used ? true : false, description, req.files.length > 0 ? req.files.map((item) => item.filename) : oldImages.rows[0].images, price, negociable ? true : false, id]);
    res.send("succes");
  } catch (error) {
    console.error(error);
    res.send("Error updating product");
  }
});

passport.use(
  new LocalStrategy({ session: false }, async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);

      if (result.rows.length > 0) {
        const user = result.rows[0];
        bcrypt.compare(password, user.password, (err, result) => {
          if (err) {
            return cb(err);
          } else {
            if (result) {
              return cb(null, user);
            } else {
              return cb(null, false, { message: "Incorrect password" });
            }
          }
        });
      } else {
        return cb(null, false, { message: "User not found" });
      }
    } catch (error) {
      return cb(error);
    }
  })
);

passport.use(
  new JWTStrategy(
    {
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    },
    async function (jwtPayload, cb) {
      try {
        const user = await db.query("SELECT * FROM users WHERE id = $1", [jwtPayload.sub]);
        if (user) {
          return cb(null, user);
        } else {
          return cb(null, false);
        }
      } catch (error) {
        return cb(error, false);
      }
    }
  )
);

const port = 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}.`);
});
