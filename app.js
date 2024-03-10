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
import GoogleStrategy from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import passportJWT from "passport-jwt";
import dotenv from "dotenv";
import fs from "fs";
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
app.use(cors());

app.use(express.json());
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static("/var/data"));

app.use(passport.initialize());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "/var/data");
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
    const { username, password, email } = req.body;

    const checkUser = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (checkUser.rows.length > 0) {
      return res.status(400).send("Email already exists");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Error hashing password");
        } else {
          try {
            const result = await db.query("INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING *", [username, hash, email]);
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

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get("/auth/google/callback", passport.authenticate("google", { session: false }), (req, res) => {
  const user = req.user.user;
  const token = req.user.jwt;
  res.redirect(`${process.env.CLIENT_URL}/?user=${JSON.stringify(user)}&token=${token}`);
});

app.get("/", (req, res) => {
  res.send("hello");
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
    const response = await db.query("SELECT products.id, title, description, new, category, images, date, price, negociable,user_id, username, registration_date, phone FROM products JOIN users ON users.id = products.user_id WHERE products.id = $1", [id]);
    res.json({ product: response.rows[0], views: views.rows[0] });
  } catch (error) {}
});

app.post("/products/:id", async (req, res) => {
  const id = req.params.id;
  // const userId = req.user.id;
  try {
    // const result = await db.query("SELECT images, user_id FROM products WHERE id = $1", [id]);
    // const productUserId = result.rows[0].user_id;

    // if (userId !== productUserId) {
    //   return res.status(403).send("Unauthorized");
    // }

    result.rows[0].images.forEach((image) => {
      fs.unlink(`/var/data/${image}`, (err) => {
        if (err) throw err;
        console.log(`uploads/${image} was deleted`);
      });
    });
    await db.query("DELETE FROM products WHERE id = $1", [id]);
    res.send("Listing deleted");
  } catch (error) {
    console.error(error);
    res.status(500).send("Listing could not be deleted try again...");
  }
});
app.post("/listing", upload.any(), async (req, res) => {
  try {
    const { title, description, category, used, price, negociable, userId, phone } = req.body;
    await db.query("INSERT INTO products (title, description, category, new, images, price, negociable, user_id, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ", [title, description, category, used ? true : false, req.files.map((item) => item.filename), price, negociable ? true : false, userId, phone]);
    res.send("Listing created succesfully");
  } catch (error) {
    console.error("Error while creating listing:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/listing/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const response = await db.query("SELECT products.id, title, description, new, category, images, price, negociable,user_id, username, phone FROM products JOIN users ON users.id = products.user_id WHERE products.id = $1", [id]);
    res.json(response.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

app.patch("/listing/:id", upload.any(), async (req, res) => {
  const id = req.params.id;
  const { title, category, used, description, price, negociable, phone } = req.body;
  try {
    const oldImages = await db.query("SELECT images FROM products WHERE id = $1", [id]);
    if (req.files.length > 0) {
      oldImages.rows[0].images.forEach((image) => {
        fs.unlink(`/var/data/${image}`, (err) => {
          if (err) throw err;
          console.log(`uploads/${image} was deleted`);
        });
      });
    }
    await db.query("UPDATE products SET title = $1, category = $2, new = $3, description = $4, images = $5, price = $6, negociable = $7, phone = $9 WHERE id = $8", [title, category, used ? true : false, description, req.files.length > 0 ? req.files.map((item) => item.filename) : oldImages.rows[0].images, price, negociable ? true : false, id, phone]);
    res.send("succes");
  } catch (error) {
    console.error(error);
    res.send("Error updating product");
  }
});

app.get("/mylistings", passport.authenticate("jwt", { session: false }), async (req, res) => {
  if (!req.user) {
    res.status(401).send("Unauthorized!");
  }
  const id = req.user.id;
  try {
    const response = await db.query("SELECT * FROM products WHERE user_id = $1 ORDER BY id", [id]);
    res.json(response.rows);
  } catch (error) {
    console.error(error);
    res.status(401).send("Unauthorized!");
  }
});

app.get("/user/listings/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const response = await db.query("SELECT products.id, title, description, new, category, images, price, negociable,user_id, username FROM products JOIN users ON users.id = products.user_id WHERE user_id = $1", [id]);
    res.send(response.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching products");
  }
});

app.get("/user/profile/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    const resultProducts = await db.query("SELECT * FROM products WHERE user_id = $1", [id]);
    res.json({ user: result.rows[0], itemCount: resultProducts.rowCount });
  } catch (error) {
    console.log(error);
    res.status(500).send("Error fetching user");
  }
});

app.post("/user/profile/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const username = req.body.username;
    await db.query("UPDATE users SET username = $1 WHERE id = $2", [username, id]);
    res.send("Updated");
  } catch (error) {
    console.log(error);
    res.status(500).send("Couldn't update user");
  }
});

passport.use(
  "local",
  new LocalStrategy({ session: false }, async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [username]);

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
  "jwt",
  new JWTStrategy(
    {
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    },
    async function (jwtPayload, cb) {
      try {
        const response = await db.query("SELECT * FROM users WHERE id = $1", [jwtPayload.sub]);
        const user = response.rows[0];
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

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://seller-project-server-1.onrender.com/auth/google/callback",
      session: false,
      scope: ["profile", "email"],
    },
    async function (accessToken, refreshToken, profile, cb) {
      const user_profile = profile._json;
      try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [user_profile.email]);
        if (result.rows.length == 0) {
          const newUser = await db.query("INSERT INTO users (username, email, password) VALUES ($1,$2,$3) RETURNING *", [user_profile.given_name, user_profile.email, "google"]);
          const jwtToken = jwt.sign({ sub: newUser.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "1d" });
          cb(null, { user: newUser.rows[0], jwt: jwtToken });
        } else {
          const jwtToken = jwt.sign({ sub: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "1d" });

          cb(null, { user: result.rows[0], jwt: jwtToken });
        }
      } catch (error) {
        cb(error);
      }
    }
  )
);

const port = 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}.`);
});
