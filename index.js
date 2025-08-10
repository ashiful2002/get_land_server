const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_GETWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

const serviceAccount = require("./real-estate-firebase-admin-sdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
const allowedOrigins = [
  "http://localhost:5173", // local dev
  "http://localhost:5174", // local dev
  "https://real-estate-client-2025.web.app", // Firebase hosting URL
  "https://real-estate-client-2025.firebaseapp.com", // Optional fallback
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    console.log(error);

    return res.status(403).send({ message: "Forbidden access" });
  }
};

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const db = client.db("realEstate");
    const usersCollection = db.collection("users");
    const propertiesCollection = db.collection("properties");
    const wishlistCollection = db.collection("wishlist");
    const reviewsCollection = db.collection("reviews");
    const offeredCollection = db.collection("makeOffer");
    const paymentsCollection = db.collection("payments");

    console.log("Connected to MongoDB");

    // === users apis ==============
    // get users
    app.get("/users", verifyFirebaseToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;

      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
      const userEmail = req.params.email;
      const user = await usersCollection.findOne({ email: userEmail });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user.role || "user" });
    });

    // update users role
    app.put("/users/:email/role", verifyFirebaseToken, async (req, res) => {
      const { email } = req.params;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(result);
    });
    // update users as fraud

    app.put("/users/:email/fraud", verifyFirebaseToken, async (req, res) => {
      const { email } = req.params;
      try {
        await usersCollection.updateOne(
          { email },
          { $set: { status: "fraud" } }
        );
        await propertiesCollection.deleteMany({ agent_email: email });
        res.send({ message: "Marked as fraud and properties removed" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update user useing put
    app.put("/users/:email", verifyFirebaseToken, async (req, res) => {
      const { email } = req.params;
      const updateData = req.body;
      const result = await usersCollection.updateOne(
        { email },
        {
          $set: updateData,
        }
      );
      res.send(result);
    });
    // post apis
    app.post("/users", verifyFirebaseToken, async (req, res) => {
      const userData = req.body;

      try {
        const existingUser = await usersCollection.findOne({
          email: userData.email,
        });

        if (existingUser) {
          // update only the last log in

          const result = await usersCollection.updateOne(
            {
              email: userData.email,
            },
            {
              $set: { last_log_in: new Date().toISOString() },
            }
          );
          return res.send({ message: "User log in updated", result });
        } else {
          // if new user - set both
          userData.created_at = new Date().toISOString();
          userData.last_log_in = new Date().toISOString();

          const result = await usersCollection.insertOne(userData);
          return res.send({ message: "New User created", result });
        }
      } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).send({ error: "Failed to save user" });
      }
    });

    app.delete("/users/:email", verifyFirebaseToken, async (req, res) => {
      const { email } = req.params;

      const result = await usersCollection.deleteOne({ email });

      res.send(result);
    });
    // ============================= users apis ends ========

    // ===== properties apis start=================

    // advertise properties
    app.patch(
      "/advertise-property/:id",

      async (req, res) => {
        const id = req.params.id;
        try {
          const result = await propertiesCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                isAdvertised: true,
                advertisedAt: new Date().toISOString(),
              },
            }
          );
          res.send(result);
        } catch (error) {
          console.error("Advertise update error:", error);
          res.status(500).send({ message: "Failed to advertise property" });
        }
      }
    );
    // get advertise properties
    // GET advertised properties
    app.get("/advertised-properties", async (req, res) => {
      const advertised = await propertiesCollection
        .find({ isAdvertised: true })
        .sort({ advertisedAt: -1 })
        .toArray();
      res.send(advertised);
    });

    ///=============================//
    app.get("/properties", verifyFirebaseToken, async (req, res) => {
      try {
        const search = req.query.search;
        const sortBy = req.query.sortBy;
        const sort = req.query.sort;


        if (search) {
          const searchRegex = new RegExp(search, "i");
          query.$or = [{ location: { $regex: searchRegex } }];
        }

        const sortOption = {};
        if (sort === "asc" && (sortBy === "minPrice" || sortBy === "maxPrice"))
          sortOption[sortBy] = 1;
        else if (
          sort === "desc" &&
          (sortBy === "minPrice" || sortBy === "maxPrice")
        )
          sortOption[sortBy] = -1;

        const result = await propertiesCollection
          .find()
          .sort(sortOption)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Property search error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // get propery by id
    app.get("/properties/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    // properties added by agent
    app.get(
      "/properties/agent/:email",
      verifyFirebaseToken,
      async (req, res) => {
        const email = req.params.email;
        const query = { agent_email: email };
        const result = await propertiesCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.post("/properties", verifyFirebaseToken, async (req, res) => {
      const property = req.body;
      const { agent_email } = property;
      property.maxPrice = Number(property.maxPrice)
            property.minPrice = Number(property.minPrice)

      const agent = await usersCollection.findOne({ email: agent_email });
      if (!agent || agent.status === "fraud") {
        return res
          .status(403)
          .send({ message: "Fraud agents can't add properties" });
      }
      const result = await propertiesCollection.insertOne(property);
      res.send(result);
    });
    // mupdate property by id
  app.patch("/properties/:id", async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  const result = await propertiesCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
  );

  res.send(result);
});


    app.patch(
      "/properties/update/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const propertyId = res.params.propertyId;
        const { status } = req.body;
        try {
          const filer = { propertyId };

          const updatedDoc = {
            $set: { status },
          };
          const result = await propertiesCollection.updateOne(
            filer,
            updatedDoc
          );

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "update error" });
        }
      }
    );
    // Patch Property to verify
    app.patch(
      "/properties/verify/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const { id } = req.params;
        const update = {
          $set: { status: "verified" },
        };
        const result = await propertiesCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          update
        );
        res.send(result);
      }
    );
    // Patch Property to reject
    app.patch(
      "/properties/reject/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const id = req.params.id;
        const update = {
          $set: { status: "reject" },
        };
        const result = await propertiesCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          update
        );
        res.send(result);
      }
    );

    app.delete("/properties/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await propertiesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    // =========================== properties apis ends==========

    // === wishlist starts =======================
    app.get("/wishlist", verifyFirebaseToken, async (req, res) => {
      try {
        const { email } = req.query;

        const query = { userEmail: email };
        const result = await wishlistCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        console.error("Error fetching wishlist:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/wishlist/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };

      const result = await wishlistCollection.findOne(query);

      res.send(result);
    });
    // post wishlist
    app.post("/wishlist", verifyFirebaseToken, async (req, res) => {
      const wishlist = req.body;

      const { propertyId, userEmail } = req.body;
      if (!userEmail) {
        return res
          .status(400)
          .send({ message: "propertyId and userEmail are required" });
      }
      const exist = await wishlistCollection.findOne({ propertyId, userEmail });
      if (exist) {
        return res
          .status(400)
          .send({ message: "Property already in wishlist" });
      }
      const result = await wishlistCollection.insertOne(wishlist);
      res.send(result);
    });

    app.delete("/wishlist/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      console.log("wishlist id", id);

      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    // ===================== wishlist api ends ========

    // ===== make offer api starts ==============

    // have to double check this route before deployu
    app.get("/make-offer", verifyFirebaseToken, async (req, res) => {
      const agent_email = req.query.agent_email;
      const buyer_email = req.query.buyer_email;

      let query = {};
      if (agent_email) query.agent_email = agent_email;
      if (buyer_email) query.buyerEmail = buyer_email;
      const result = await offeredCollection.find(query).toArray();
      res.send(result);
    });

    app.put("/offers/:id/accept", verifyFirebaseToken, async (req, res) => {
      const offerId = req.params.id;
      const acceptedOffer = await offeredCollection.findOne({
        _id: new ObjectId(offerId),
      });

      // Accept the selected offer
      await offeredCollection.updateOne(
        { _id: new ObjectId(offerId) },
        { $set: { status: "accepted", decisionAt: new Date().toISOString() } }
      );

      // Reject all other offers for the same property
      await offeredCollection.updateMany(
        {
          propertyId: acceptedOffer.propertyId,
          _id: { $ne: acceptedOffer._id },
        },
        { $set: { status: "rejected" } }
      );

      res.send({ message: "Offer accepted and others rejected" });
    });

    app.get("/make-offer/:id", async (req, res) => {
      const id = req.params.id;
      const result = await offeredCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.patch("/make-offer/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const { status, transaction_Id } = req.body;

      const filer = { propertyId: id };

      const updatedDoc = {
        $set: { status: status, transaction_Id: transaction_Id },
      };
      const result = await offeredCollection.updateOne(filer, updatedDoc);
      res.send(result);
    });
    app.post("/make-offer", verifyFirebaseToken, async (req, res) => {
      const offeredPrice = req.body;
      const result = await offeredCollection.insertOne(offeredPrice);
      res.send(result);
    });
    app.delete("/make-offer/:id", verifyFirebaseToken, async (req, res) => {
      const { propertyId } = req.params;

      const result = await offeredCollection.deleteOne({ propertyId });
      res.send(result);
    });
    // payment
    app.get("/payment-history", verifyFirebaseToken, async (req, res) => {
      try {
        const { email, propertyId, offerId } = req.query;

        const query = {};
        if (email) query.buyerEmail = email;
        if (propertyId) query.propertyId = propertyId;
        // if (offerId) query.offerId = offerId;

        const payments = await paymentsCollection
          .find(query)
          .sort({ paidAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    app.put("/payment/:id/paid", verifyFirebaseToken, async (req, res) => {
      const offerId = req.params.id;
      try {
        const {
          transaction_Id,
          paidAt,
          propertyId,
          title,
          agent_name,
          buyerEmail,
          buyerName,
          offerAmount,
        } = req.body;

        // Step 1: Mark offer as bought
        await offeredCollection.updateOne(
          { _id: new ObjectId(offerId) },
          {
            $set: {
              status: "bought",
              transactionId: transaction_Id,
              paidAt,
            },
          }
        );

        // Step 2: Save in payments collection
        const paymentEntry = {
          transaction_Id,
          offerId,
          propertyId,
          title,
          agent_name,
          buyerEmail,
          buyerName,
          offerAmount,
          paidAt: paidAt,
        };

        const result = await paymentsCollection.insertOne(paymentEntry);

        res.send({
          success: true,
          message: "Payment recorded and offer marked as bought",
          paymentId: result.insertedId,
        });
      } catch (error) {
        console.error("Payment saving failed:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    app.put("/offers/:id/reject", verifyFirebaseToken, async (req, res) => {
      const offerId = req.params.id;

      await offeredCollection.updateOne(
        { _id: new ObjectId(offerId) },
        { $set: { status: "rejected" } }
      );

      res.send({ message: "Offer rejected" });
    });

    // ===================== make offer api ends ========

    // ===== reviews api starts ==============

    app.get("/reviews", verifyFirebaseToken, async (req, res) => {
      const { propertyId } = req.query;
      const query = propertyId ? { propertyId } : {};
      const result = await reviewsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/reviews/:email", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { reviewer_email: email };
      const result = await reviewsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/latest-review", async (req, res) => {
      const { review } = req.query;
      const result = await reviewsCollection
        .find(review)
        .sort({ date: -1 })
        .limit(4)
        .toArray();
      res.send(result);
    });
    app.post("/reviews", async (req, res) => {
      const review = req.body;

      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    app.delete("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    // ==================== reviews api ends =====
    //====  delete from firebase ======

    app.delete("/firebase-users/:uid", async (req, res) => {
      const { uid } = req.params;
      try {
        await admin.auth().deleteUser(uid);
        res.send({ success: true });
      } catch (error) {
        console.error("Firebase deletion error:", error);
        res.status(500).send({ error: error.message });
      }
    });
    //============ stripe payment ===========
    // Create a PaymentIntent
    app.post("/create-payment-intent", async (req, res) => {
      const { amountInCents, parcelId } = req.body;
      console.log(amountInCents, parcelId);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    //============ stripe payment ===========
  } catch (err) {
    console.error(" MongoDB connection error:", err);
  }
  // ====================================== //
}

run();

app.get("/", (req, res) => {
  res.send(" Real Estate server is running");
});

app.listen(port, () => {
  console.log(` Server is running on port ${port}`);
});
