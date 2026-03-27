import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let rawBody = "";

        request.on("data", (chunk) => {
            rawBody += chunk.toString("utf8");
        });
        request.on("end", () => {
            try {
                resolve(rawBody ? JSON.parse(rawBody) : {});
            } catch {
                reject(new Error("Invalid JSON body"));
            }
        });
        request.on("error", reject);
    });
}

function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
}

function getSingleHeader(request, name) {
    const raw = request.headers[name.toLowerCase()];

    if (Array.isArray(raw)) {
        return raw[0] || "";
    }

    return raw || "";
}

async function postToEtsyToken(payload) {
    const response = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(payload),
    });

    const text = await response.text();

    try {
        return {
            status: response.status,
            payload: JSON.parse(text),
        };
    } catch {
        return {
            status: response.status,
            payload: {
                message: text || "Unexpected Etsy token response",
            },
        };
    }
}

async function forwardEtsyGet(request, upstreamPath) {
    const apiKey = getSingleHeader(request, "x-etsy-api-key");
    const accessToken = getSingleHeader(request, "x-etsy-access-token");

    if (!apiKey || !accessToken) {
        return {
            status: 400,
            payload: {
                message:
                    "Missing Etsy auth headers (x-etsy-api-key, x-etsy-access-token).",
            },
        };
    }

    const response = await fetch(`https://openapi.etsy.com${upstreamPath}`, {
        method: "GET",
        headers: {
            "x-api-key": apiKey,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const text = await response.text();

    try {
        return {
            status: response.status,
            payload: JSON.parse(text),
        };
    } catch {
        return {
            status: response.status,
            payload: {
                message: text || "Unexpected Etsy API response",
            },
        };
    }
}

function etsyOauthProxy() {
    const handler = async (request, response, next) => {
        const url = new URL(request.url || "/", "http://localhost");

        if (url.pathname.startsWith("/api/etsy/proxy/")) {
            if (request.method !== "GET") {
                sendJson(response, 405, { message: "Method not allowed" });
                return;
            }

            const relativePath = url.pathname.replace("/api/etsy/proxy/", "");
            const upstreamPath = `/v3/application/${relativePath}${url.search}`;
            const result = await forwardEtsyGet(request, upstreamPath);
            sendJson(response, result.status, result.payload);
            return;
        }

        if (
            url.pathname !== "/api/etsy/oauth/token" &&
            url.pathname !== "/api/etsy/oauth/refresh"
        ) {
            next();
            return;
        }

        if (request.method !== "POST") {
            sendJson(response, 405, { message: "Method not allowed" });
            return;
        }

        try {
            const body = await readRequestBody(request);

            if (url.pathname === "/api/etsy/oauth/token") {
                const {
                    clientId,
                    clientSecret,
                    code,
                    redirectUri,
                    codeVerifier,
                } = body;

                if (
                    !clientId ||
                    !clientSecret ||
                    !code ||
                    !redirectUri ||
                    !codeVerifier
                ) {
                    sendJson(response, 400, {
                        message: "Missing required token exchange fields",
                    });
                    return;
                }

                const result = await postToEtsyToken({
                    grant_type: "authorization_code",
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    code,
                    code_verifier: codeVerifier,
                });

                sendJson(response, result.status, result.payload);
                return;
            }

            if (url.pathname === "/api/etsy/oauth/refresh") {
                const { clientId, clientSecret, refreshToken } = body;

                if (!clientId || !clientSecret || !refreshToken) {
                    sendJson(response, 400, {
                        message: "Missing required refresh fields",
                    });
                    return;
                }

                const result = await postToEtsyToken({
                    grant_type: "refresh_token",
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: refreshToken,
                });

                sendJson(response, result.status, result.payload);
                return;
            }

            sendJson(response, 404, { message: "Not found" });
        } catch (error) {
            sendJson(response, 500, {
                message:
                    error instanceof Error
                        ? error.message
                        : "OAuth proxy failed",
            });
        }
    };

    return {
        name: "etsy-oauth-proxy",
        configureServer(server) {
            server.middlewares.use(handler);
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss(), etsyOauthProxy()],
});
