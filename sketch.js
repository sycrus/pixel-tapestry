

// each tile contains square grid of patterns
let dims = 2 ; // rows of 5 x 5 patterns <-- change this


let numPoints; // 5 points 5 strips per tile
let points = []; // one for each quadrant of kaleidoscope
let points2 = [];
let points3 = [];
let points4 = [];

const pointsPerTile = 5; // 5 points per section FIXED
let tileLength = 0; // same as tileheight
let segLength = 0;
let bitArrays = ['11111',  '11011', '10101', '10001', '01110', '00100', '01010', '00000'];

function setup() { 
  createCanvas(1000, 1000);
  colorMode(HSB, 100);
  
  setupTileConst();
  setupAllTiles();  
}

function draw() {
  background(255);
  for (let i = 0 ; i < points.length ; i++) {
    points[i].draw();
    points2[i].draw();
    points3[i].draw();
    points4[i].draw();
  }
}