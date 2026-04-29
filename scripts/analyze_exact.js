const beforeRaw = [0.6, 0.8, 0.7, 0.85, 0.85, 0.4, 0.8, 0.6, 0.7, 0.75, 0.65, 0.85, 0.8, 0.6, 0.3, 0.95, 0.5, 0.9, 0.9, 0.2, 0.8, 0.5, 0.55, 0.65, 0.9, 0.2, 0.8, 0.3, 0.75, 0.4, 0.9, 0.3, 0.7, 0.5, 0.95, 0.1, 0.8, 0.7, 0.7, 0.6, 0.65, 0.65, 0.9, 0.2, 0.8, 0.4, 0.55, 0.75, 0.9, 0.2, 0.8, 0.3, 0.85, 0.25, 0.5, 0.9, 0.8, 0.7, 0.7, 0.8];

const afterRaw = [0.47, 0.82, 0.63, 0.78, 0.89, 0.23, 0.78, 0.34, 0.71, 0.52, 0.43, 0.81, 0.73, 0.42, 0.31, 0.89, 0.58, 0.76, 0.87, 0.23, 0.74, 0.58, 0.61, 0.79, 0.94, 0.12, 0.87, 0.23, 0.71, 0.58, 0.87, 0.34, 0.62, 0.71, 0.94, 0.18, 0.67, 0.74, 0.82, 0.43, 0.51, 0.79, 0.87, 0.23, 0.74, 0.41, 0.62, 0.78, 0.87, 0.23, 0.82, 0.31, 0.91, 0.18, 0.47, 0.84, 0.73, 0.61, 0.68, 0.72];

function process(arr, name) {
  const ai = [];
  const hum = [];
  for (let i = 0; i < arr.length; i++) {
    if (i % 2 === 0) ai.push(arr[i]);
    else hum.push(arr[i]);
  }

  console.log(`\n=== ${name} ===`);
  
  function analyze(subArr, label) {
    const mean = subArr.reduce((a,b)=>a+b,0) / subArr.length;
    console.log(`\n-- ${label} (n=${subArr.length}) --`);
    console.log(`Mean: ${mean.toFixed(3)}`);
    
    // Exact value count vs neighbors
    const anchors = [0.75, 0.35, 0.50, 0.70, 0.30];
    
    anchors.forEach(a => {
      let exactCount = 0;
      let neighborCount = 0;
      let neighborPoints = 0;
      
      const aStr = a.toFixed(2);
      
      subArr.forEach(val => {
        const diff = Math.abs(val - a);
        if (diff < 0.001) {
          exactCount++;
        } else if (diff > 0.001 && diff <= 0.021) {
          neighborCount++;
        }
      });
      
      console.log(`Anchor ${aStr}: Exact=${exactCount}, Neighbors(±0.02)=${neighborCount}`);
    });
  }
  
  analyze(ai, 'AI Exposure Score');
  analyze(hum, 'Human Criticality Score');
}

process(beforeRaw, 'BEFORE (Anchored)');
process(afterRaw, 'AFTER (Sanitized)');
