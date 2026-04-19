export const LINKEDIN_VERSION = "202401";

type LinkedInMedia = {
  imageUrl?: string;
  url?: string;
  title?: string;
  description?: string;
};

type BufferUpdateOptions = {
  link?: string;
  imageUrl?: string;
  title?: string;
  description?: string;
  now?: boolean;
  scheduledAt?: string;
};

export type BufferProfile = {
  id: string;
  service: string;
  serviceUsername: string | null;
  formattedUsername: string | null;
  isDefault?: boolean;
};

export function isHttpUrl(value: string | null | undefined) {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

export function isImageUrl(value: string | null | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed)) return true;

  try {
    const url = new URL(trimmed);
    return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
  } catch {
    return false;
  }
}

export function extractFirstNonImageUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const matches = value.match(/https?:\/\/\S+/gi) || [];

    for (const match of matches) {
      const sanitized = match.replace(/[),.;!?]+$/, "");
      if (!isImageUrl(sanitized)) {
        return sanitized;
      }
    }
  }

  return null;
}

function inferMimeTypeFromUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const candidate = `${url.pathname}${url.search}${url.hash}`.toLowerCase();
    if (candidate.includes(".png")) return "image/png";
    if (candidate.includes(".gif")) return "image/gif";
    if (candidate.includes(".webp")) return "image/webp";
    if (candidate.includes(".svg")) return "image/svg+xml";
    if (candidate.includes(".jpg") || candidate.includes(".jpeg")) return "image/jpeg";
  } catch {
    return null;
  }

  return null;
}

function parseDataImageUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error("Unsupported data image URL");
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

export async function loadImageBinary(source: string) {
  if (/^data:image\//i.test(source)) {
    return parseDataImageUrl(source);
  }

  const response = await fetch(source, {
    method: "GET",
    headers: {
      Accept: "image/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim()
    || inferMimeTypeFromUrl(source)
    || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();

  return {
    mimeType,
    bytes: Buffer.from(arrayBuffer),
  };
}

async function uploadLinkedInImage(accessToken: string, authorUrn: string, imageUrl: string) {
  const registerResponse = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_VERSION,
    },
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
      },
    }),
  });

  if (!registerResponse.ok) {
    const errorBody = await registerResponse.text().catch(() => "");
    let errorMessage = errorBody;
    try {
      const json = JSON.parse(errorBody);
      errorMessage = json.message || json.error || errorBody;
    } catch (e) {}
    throw new Error(errorMessage || `LinkedIn image initialization failed with status ${registerResponse.status}`);
  }

  const registerPayload = await registerResponse.json() as {
    value?: {
      uploadUrl?: string;
      image?: string;
    };
  };

  const assetUrn = registerPayload.value?.image;
  const uploadUrl = registerPayload.value?.uploadUrl;
  if (!assetUrn || !uploadUrl) {
    throw new Error("LinkedIn image initialization did not return an upload target");
  }

  const image = await loadImageBinary(imageUrl);
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": image.mimeType,
    },
    body: image.bytes,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => "");
    throw new Error(errorText || `LinkedIn image upload failed with status ${uploadResponse.status}`);
  }

  return assetUrn;
}

export async function createLinkedInPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  media?: LinkedInMedia,
) {
  const hasImage = Boolean(media?.imageUrl);
  const hasArticle = Boolean(media?.url) && !hasImage;
  const uploadedAssetUrn = hasImage && media?.imageUrl
    ? await uploadLinkedInImage(accessToken, authorUrn, media.imageUrl)
    : null;

  const body: any = {
    author: authorUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
  };

  if (hasImage && uploadedAssetUrn) {
    body.content = {
      media: {
        id: uploadedAssetUrn,
        ...(media?.title ? { title: media.title } : {}),
      },
    };
  } else if (hasArticle && media?.url) {
    body.content = {
      article: {
        source: media.url,
        ...(media?.title ? { title: media.title } : {}),
        ...(media?.description ? { description: media.description } : {}),
      },
    };
  }

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    let errorMessage = errorBody;
    try {
      const json = JSON.parse(errorBody);
      errorMessage = json.message || json.error || errorBody;
    } catch (e) {}
    throw new Error(errorMessage || `LinkedIn post creation failed with status ${response.status}`);
  }

  return {
    postId: response.headers.get("x-restli-id") || response.headers.get("X-RestLi-Id"),
  };
}

export async function fetchBufferProfiles(accessToken: string) {
  const params = new URLSearchParams({ access_token: accessToken });
  const response = await fetch(`https://api.bufferapp.com/1/profiles.json?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Buffer authentication failed with status ${response.status}`);
  }

  const payload = await response.json() as Array<{
    id?: string;
    service?: string;
    service_username?: string;
    formatted_username?: string;
    default?: boolean;
  }>;

  return Array.isArray(payload)
    ? payload
        .filter((profile) => profile.id)
        .map((profile) => ({
          id: profile.id as string,
          service: profile.service || "unknown",
          serviceUsername: profile.service_username || null,
          formattedUsername: profile.formatted_username || null,
          isDefault: Boolean(profile.default),
        }))
    : [];
}

export async function createBufferUpdate(
  accessToken: string,
  profileIds: string[],
  text: string,
  options: BufferUpdateOptions = {},
) {
  const params = new URLSearchParams();
  params.set("access_token", accessToken);
  params.set("text", text);
  params.set("shorten", "true");

  for (const profileId of profileIds) {
    params.append("profile_ids[]", profileId);
  }

  if (options.now) {
    params.set("now", "true");
  }

  if (options.scheduledAt) {
    params.set("scheduled_at", options.scheduledAt);
  }

  if (options.imageUrl && isHttpUrl(options.imageUrl)) {
    params.set("media[photo]", options.imageUrl);
  } else if (options.link && isHttpUrl(options.link)) {
    params.set("media[link]", options.link);
    if (options.title) {
      params.set("media[title]", options.title);
    }
    if (options.description) {
      params.set("media[description]", options.description);
    }
  }

  const response = await fetch("https://api.bufferapp.com/1/updates/create.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Buffer update creation failed with status ${response.status}`);
  }

  return response.json() as Promise<{
    success?: boolean;
    updates?: Array<{ id?: string; profile_id?: string; status?: string }>;
  }>;
}
