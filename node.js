
// Class for one of five strips in one tile
class Node {
    constructor(x, y, segmentWidth, pattValue) {
        this.x = x;
        this.y = y;
        this.width = segmentWidth;
        this.patt = pattValue;
    }
    update() {

    }
    setXY(x, y) {
        this.x = x ;
        this.y = y ;
    }
    draw() {
        push();
        noStroke();
        translate(this.x, this.y);
            push();
            for (let i = 0 ; i < pointsPerTile ; i++) {
                fill(this.patt[i] * 100);
                rect(0, this.width * (i - 2), this.width, this.width);
            }
            pop();
        pop();
    }

}


function setupTileConst() {
    rectMode(CENTER);
    //setup dims
    tileLength = (width/2) / (dims); // this is constant. dim of each tile
    numPoints = dims * pointsPerTile;  // points per row
    segLength = tileLength/(pointsPerTile); 
  }
  
  function setupAllTiles() {
    for (let j = 0 ; j < dims ; j++){
      for (let i = 0 ; i < dims ; i++) {
        generateTile(segLength/2 + (i) * tileLength,
                     segLength * 2.5 + (j) * tileLength);
      }
    }
  }
  
  // 5 x 5 tiles
  function generateTile(x, y) {
    for (let i = 0 ; i < pointsPerTile; i++) {
      let stripPattern = generateStrip(); // generates strip for each column of the pattern
      // pieces together 5 strips in order
      for (let j = 0 ; j < pointsPerTile ; j++ ) { 
        // constructor(x, y, segmentWidth, pattValue) {
        points.push(new Node(x + j * segLength, y, segLength, stripPattern[j]));
        points2.push(new Node(width - segLength * 4 - x + j * segLength, y, segLength, stripPattern[j]));
        points3.push(new Node(width - segLength * 4 - x + j * segLength, height - y, segLength, stripPattern[j]));
        points4.push(new Node(x + j * segLength, height - y, segLength, stripPattern[j]));
      }
    }
  }
  
  // hard coded: 5 points on a strip
  function generateStrip() {
    let rows = [];
    rows[0] = random(bitArrays);
    rows[1] = random(bitArrays);
    rows[2] = random(bitArrays);
    rows[3] = rows[1];
    rows[4] = rows[0];
    return rows;
  }