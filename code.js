// code.js — main thread with original size support
// Enhanced version for high-quality image placement

var MAX_CONCURRENT = 1;
var CACHE_PREFIX = "cdn-imghash:";
var SIZE_CACHE_PREFIX = "cdn-size:";

console.log("People CDN Browser v4.0 - Original Size Support");

figma.showUI(__html__, { width: 460, height: 620 });

figma.ui.onmessage = async function (msg) {
  try {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "place-images") {
      var urls = Array.isArray(msg.urls) ? msg.urls : [];
      var useOriginalSize = msg.useOriginalSize !== undefined ? msg.useOriginalSize : true;

      console.log("Place request:", urls.length, "images, use original size:", useOriginalSize);

      if (urls.length === 0) {
        figma.ui.postMessage({ type: "error", message: "No URLs provided" });
        return;
      }

      var validUrls = urls.filter(function(url) {
        return typeof url === "string" && url.startsWith("https://") && url.includes("d3a10mptdebtwd.cloudfront.net");
      });

      if (validUrls.length === 0) {
        figma.ui.postMessage({ type: "error", message: "No valid CDN URLs found" });
        return;
      }

      figma.ui.postMessage({ type: "progress", stage: "received", total: validUrls.length });

      try {
        var placed = await placeImagesOriginalSize(validUrls, useOriginalSize);
        
        if (placed > 0) {
          figma.ui.postMessage({ type: "placed", count: placed });
          if (figma.currentPage.selection.length > 0) {
            figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
          }
        } else {
          figma.ui.postMessage({ type: "error", message: "No images could be processed successfully" });
        }
      } catch (placeError) {
        figma.ui.postMessage({ type: "error", message: "Processing failed: " + placeError.message });
      }
    }
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: "Plugin error: " + (err.message || String(err)) });
  }
};

async function placeImagesOriginalSize(urls, useOriginalSize) {
  console.log("=== Processing with original size:", useOriginalSize, "===");
  
  var successfulImages = [];

  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    var filename = url.split("/").pop() || "image";
    
    figma.ui.postMessage({ 
      type: "progress", 
      stage: "download", 
      done: i, 
      total: urls.length,
      currentFile: filename
    });

    try {
      // Get cached size first if available
      var cachedSize = await getCachedImageSize(url);
      
      // Create image hash
      var imageResult = await createImageFromUrl(url);
      
      if (!imageResult || !imageResult.hash) {
        imageResult = await createImageFromBytes(url);
      }
      
      if (imageResult && imageResult.hash) {
        var finalWidth, finalHeight;
        
        if (useOriginalSize) {
          // Use original dimensions - aim for high quality
          finalWidth = imageResult.width || (cachedSize ? cachedSize.width : 1600);
          finalHeight = imageResult.height || (cachedSize ? cachedSize.height : 2000);
          
          // If we don't have actual dimensions, use high-quality defaults for people photos
          if (!imageResult.width && !cachedSize) {
            finalWidth = 1600;  // High resolution default
            finalHeight = 2000; // Portrait ratio common for people photos
          }
          
          console.log("✓ Using original/full size:", finalWidth + "x" + finalHeight, "for", filename);
        } else {
          // Use scaled down version (1000px max for better quality than before)
          var originalWidth = imageResult.width || (cachedSize ? cachedSize.width : 1600);
          var originalHeight = imageResult.height || (cachedSize ? cachedSize.height : 2000);
          
          var scaledDimensions = scaleToMaxSize(originalWidth, originalHeight, 1000);
          finalWidth = scaledDimensions.width;
          finalHeight = scaledDimensions.height;
          
          console.log("✓ Using scaled size:", finalWidth + "x" + finalHeight, "from original", originalWidth + "x" + originalHeight, "for", filename);
        }
        
        // Cache the size for future use
        if (imageResult.width && imageResult.height) {
          await cacheImageSize(url, imageResult.width, imageResult.height);
        }
        
        successfulImages.push({
          hash: imageResult.hash,
          url: url,
          filename: filename,
          width: finalWidth,
          height: finalHeight,
          originalWidth: imageResult.width || (cachedSize ? cachedSize.width : finalWidth),
          originalHeight: imageResult.height || (cachedSize ? cachedSize.height : finalHeight)
        });
        
      } else {
        throw new Error("Failed to create image hash");
      }
      
    } catch (e) {
      console.error("✗ Failed:", filename, "-", e.message);
      figma.ui.postMessage({ type: "progress", stage: "error", url: url, error: e.message });
    }

    figma.ui.postMessage({ type: "progress", stage: "download", done: i + 1, total: urls.length });
    
    if (i < urls.length - 1) {
      await new Promise(function(r) { setTimeout(r, 200); });
    }
  }

  if (successfulImages.length === 0) {
    return 0;
  }

  return await createVariableSizedRectangles(successfulImages);
}

function scaleToMaxSize(originalWidth, originalHeight, maxSize) {
  // Don't scale if dimensions are reasonable and maxSize is generous
  if (maxSize >= 1000 && originalWidth <= maxSize * 1.2 && originalHeight <= maxSize * 1.2) {
    return { width: originalWidth, height: originalHeight };
  }
  
  if (originalWidth <= maxSize && originalHeight <= maxSize) {
    return { width: originalWidth, height: originalHeight };
  }
  
  var aspectRatio = originalWidth / originalHeight;
  
  if (originalWidth > originalHeight) {
    // Landscape: fit to width
    return {
      width: maxSize,
      height: Math.round(maxSize / aspectRatio)
    };
  } else {
    // Portrait or square: fit to height
    return {
      width: Math.round(maxSize * aspectRatio),
      height: maxSize
    };
  }
}

async function getCachedImageSize(url) {
  try {
    var key = SIZE_CACHE_PREFIX + url;
    var cached = await figma.clientStorage.getAsync(key);
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
}

async function cacheImageSize(url, width, height) {
  try {
    var key = SIZE_CACHE_PREFIX + url;
    await figma.clientStorage.setAsync(key, JSON.stringify({ width: width, height: height }));
  } catch (e) {
    console.log("Size cache write failed (non-fatal)");
  }
}

async function createImageFromUrl(url) {
  try {
    if (typeof figma.createImageAsync !== "function") {
      return null;
    }

    var image = await figma.createImageAsync(url);
    if (!image || !image.hash) return null;

    var result = { hash: image.hash };
    
    try {
      if (typeof image.getSizeAsync === "function") {
        var dimensions = await image.getSizeAsync();
        result.width = dimensions.width;
        result.height = dimensions.height;
        console.log("Got actual image dimensions from createImageAsync:", dimensions.width + "x" + dimensions.height);
      }
    } catch (sizeError) {
      console.log("Could not get image size from createImageAsync:", sizeError.message);
    }

    return result;
  } catch (e) {
    console.log("createImageAsync failed:", e.message);
    return null;
  }
}

async function createImageFromBytes(url) {
  try {
    var bytes = await fetchImageBytes(url);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error("No bytes received");
    }

    var uint8Array = new Uint8Array(bytes);
    var image = figma.createImage(uint8Array);
    
    if (!image || !image.hash) {
      throw new Error("createImage failed");
    }

    // Try to get dimensions if available (though createImage doesn't usually provide them)
    var result = { hash: image.hash };
    
    // Log successful creation
    console.log("Successfully created image from bytes, hash:", image.hash);
    
    return result;
  } catch (e) {
    throw e;
  }
}

async function fetchImageBytes(url) {
  var maxAttempts = 3;
  var delay = 1000;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function() { controller.abort(); }, 15000);

      var response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          'Accept': 'image/*',
          'User-Agent': 'Figma-Plugin'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return await response.arrayBuffer();
    } catch (e) {
      if (attempt === maxAttempts) {
        throw new Error("Fetch failed: " + e.message);
      }
      
      await new Promise(function(r) { setTimeout(r, delay); });
      delay *= 1.5;
    }
  }
}

async function createVariableSizedRectangles(images) {
  console.log("=== Creating variable-sized rectangles ===");
  
  var center = figma.viewport.center;
  var padding = 20;
  
  // Calculate grid layout that accommodates different sizes
  var cols = Math.ceil(Math.sqrt(images.length));
  var nodes = [];
  
  // Calculate maximum dimensions for each column and row
  var rowHeights = [];
  var colWidths = [];
  
  for (var i = 0; i < images.length; i++) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var img = images[i];
    
    // Track maximum width for each column
    colWidths[col] = Math.max(colWidths[col] || 0, img.width);
    // Track maximum height for each row
    rowHeights[row] = Math.max(rowHeights[row] || 0, img.height);
  }
  
  // Calculate starting positions
  var totalWidth = colWidths.reduce(function(sum, w) { return sum + w; }, 0) + (cols - 1) * padding;
  var totalHeight = rowHeights.reduce(function(sum, h) { return sum + h; }, 0) + (rowHeights.length - 1) * padding;
  
  var startX = center.x - totalWidth / 2;
  var startY = center.y - totalHeight / 2;
  
  for (var i = 0; i < images.length; i++) {
    var imageData = images[i];
    var col = i % cols;
    var row = Math.floor(i / cols);
    
    try {
      // Calculate position based on previous columns/rows
      var x = startX;
      for (var c = 0; c < col; c++) {
        x += colWidths[c] + padding;
      }
      
      var y = startY;
      for (var r = 0; r < row; r++) {
        y += rowHeights[r] + padding;
      }
      
      var rect = figma.createRectangle();
      rect.resize(imageData.width, imageData.height);
      rect.x = x;
      rect.y = y;

      rect.fills = [{
        type: "IMAGE",
        imageHash: imageData.hash,
        scaleMode: "FILL"
      }];

      rect.name = "CDN Image: " + imageData.filename;
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
      
      console.log("✓ Created rectangle", (i + 1), "at", x + "," + y, "size:", imageData.width + "x" + imageData.height);
      
    } catch (e) {
      console.error("✗ Rectangle creation failed:", e.message);
    }
  }

  figma.currentPage.selection = nodes;
  return nodes.length;
}