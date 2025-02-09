// trackConfigs.js

const trackConfigs = {
  speedTrack: {
	name: "Speed Track",
	scale: 4, // conversion factor from meters to pixels
	// Define buoys in meters
	buoys: [
	  { x: 20, y: 15 },
	  { x: 81.43, y: 48.56 },
	  { x: 125, y: 15 }
	],
	// For speedTrack, we use the first buoy as the start of the timing line.
	computeTimingLine: function(buoys, canvas) {
	  return {
		x1: buoys[0].x,
		y1: buoys[0].y,
		x2: canvas.width / 2,
		y2: canvas.height
	  };
	}
  },
  dubaiTrack: {
	name: "Dubai Track",
	scale: 4,
	// 150m x 75m layout
	buoys: [
// Goal Area with 2 lane separators
		{ x: 55,  y: 1 },
		{ x: 75,  y: 0 },
		{ x: 95,  y: 1 },

		// Bottom center parable
		{ x: 55,  y: 21 },
		{ x: 75,  y: 21 },
		{ x: 95,  y: 21 },
	
		// Turn 4 Top Left
		{ x: 35,  y: 55 },
		{ x: 35, y: 75 },
		{ x: 15,  y: 75 },
	
		// Turn 1 (bottom right)
		{ x: 150, y: 5 },
		{ x: 140, y: 25 },
		
		// Turn 2 Top Right
		{ x: 135, y: 75 },
		{ x: 115, y: 75 },
		{ x: 115, y: 55 },
	
		// Turn 5 bottom left
		{ x: 10,  y: 25 },
		{ x: 0,   y: 5 },
	  ],
	// For dubaiTrack, the timing line starts at the buoy closest to the bottom of the play area.
	computeTimingLine: function(buoys, canvas) {
	  // Find the buoy with the largest 'y' value (remember: y is calculated as canvas.height - (b.y * scale))
	  let bottomBuoy = buoys[0];
	  buoys.forEach(b => {
		if (b.y > bottomBuoy.y) {
		  bottomBuoy = b;
		}
	  });
	  return {
		x1: bottomBuoy.x,
		y1: bottomBuoy.y,
		x2: canvas.width / 2,
		y2: canvas.height
	  };
	}
  }
};
