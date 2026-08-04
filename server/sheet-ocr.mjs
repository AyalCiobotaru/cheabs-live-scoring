import vision from '@google-cloud/vision';

let visionClient;

export async function readPoolSheetOcr(imageDataUrl) {
  const content = dataUrlToBase64(imageDataUrl);
  const client = googleVisionClient();
  const [result] = await client.documentTextDetection({
    image: { content }
  });
  const text = result.fullTextAnnotation?.text ?? result.textAnnotations?.[0]?.description ?? '';

  return {
    text,
    lines: extractOcrLines(result.fullTextAnnotation)
  };
}

function extractOcrLines(fullTextAnnotation) {
  const lines = [];

  for (const page of fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        const words = (paragraph.words ?? []).map(normalizeVisionWord).filter(Boolean);

        if (words.length === 0) {
          continue;
        }

        lines.push(...groupWordsIntoLines(words));
      }
    }
  }

  return lines.sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
}

function normalizeVisionWord(word) {
  const text = (word.symbols ?? []).map((symbol) => symbol.text ?? '').join('');
  const bounds = boundsFromVertices(word.boundingBox?.vertices ?? []);

  if (!text.trim() || !bounds) {
    return null;
  }

  return {
    text,
    bounds,
    confidence: typeof word.confidence === 'number' ? word.confidence : null
  };
}

function groupWordsIntoLines(words) {
  const sortedWords = [...words].sort(
    (left, right) => lineCenter(left) - lineCenter(right) || left.bounds.x - right.bounds.x
  );
  const groups = [];

  for (const word of sortedWords) {
    const center = lineCenter(word);
    const existing = groups.find((group) => Math.abs(group.center - center) <= Math.max(8, group.height * 0.6));

    if (existing) {
      existing.words.push(word);
      existing.center = (existing.center + center) / 2;
      existing.height = Math.max(existing.height, word.bounds.height);
    } else {
      groups.push({
        center,
        height: word.bounds.height,
        words: [word]
      });
    }
  }

  return groups.map((group) => {
    const lineWords = group.words.sort((left, right) => left.bounds.x - right.bounds.x);
    const bounds = mergeBounds(lineWords.map((word) => word.bounds));

    return {
      text: lineWords.map((word) => word.text).join(' '),
      bounds,
      confidence: averageConfidence(lineWords)
    };
  });
}

function lineCenter(word) {
  return word.bounds.y + word.bounds.height / 2;
}

function boundsFromVertices(vertices) {
  const xs = vertices.map((vertex) => vertex.x).filter((value) => typeof value === 'number');
  const ys = vertices.map((vertex) => vertex.y).filter((value) => typeof value === 'number');

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function mergeBounds(boundsList) {
  const left = Math.min(...boundsList.map((bounds) => bounds.x));
  const top = Math.min(...boundsList.map((bounds) => bounds.y));
  const right = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function averageConfidence(words) {
  const confidences = words.map((word) => word.confidence).filter((confidence) => typeof confidence === 'number');

  if (confidences.length === 0) {
    return null;
  }

  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
}

function googleVisionClient() {
  if (visionClient) {
    return visionClient;
  }

  const credentialsJson =
    process.env.GOOGLE_CLOUD_VISION_CREDENTIALS_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const options = {};

  if (credentialsJson) {
    try {
      options.credentials = JSON.parse(credentialsJson);
      options.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID ?? options.credentials.project_id;
    } catch {
      throw httpError(503, 'Google Cloud Vision credentials JSON is invalid.', 'ERR_GOOGLE_VISION_CONFIG');
    }
  }

  visionClient = new vision.ImageAnnotatorClient(options);
  return visionClient;
}

function dataUrlToBase64(imageDataUrl) {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.trim()) {
    throw httpError(400, 'Pool Sheet image is required.', 'ERR_IMAGE_REQUIRED');
  }

  const match = imageDataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  const base64 = match?.[1] ?? imageDataUrl;

  if (!/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw httpError(400, 'Pool Sheet image must be base64 encoded.', 'ERR_IMAGE_INVALID');
  }

  return base64.replace(/\s+/g, '');
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
