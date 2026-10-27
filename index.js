const express = require("express");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "public")));




app.get("/", (req, res) => {


console.log("Estou cagado!")

res.send("Peidei!")
    //res.sendFile(path.join(__dirname, "public", "index.html"))
});



app.listen(3000, () => {
    console.log("http://localhost:3000/filho");
});