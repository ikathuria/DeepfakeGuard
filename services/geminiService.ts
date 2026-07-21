import { AnalysisResult } from "../types";
import { GoogleGenAI } from "@google/genai";

const LOCAL_API_URL = "http://localhost:8000/api/analyze";

/**
 * Audit result returned by the Gemini AI auditor model.
 */
export interface ForensicAuditReport {
  verdict: 'Authentic' | 'Suspicious' | 'Synthetic / Cloned' | 'Robotic / TTS';
  confidenceScore: number;
  prosodyAnalysis: string;
  anomalyAnalysis: string;
  forensicBreakdown: string;
  rawResponse: string;
}

/**
 * Original method: Sends audio to a local python server (if running).
 */
export const analyzeAudioSegment = async (
  base64Audio: string,
  timestamp: number
): Promise<AnalysisResult> => {
  try {
    const response = await fetch(LOCAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_base64: base64Audio,
        timestamp: timestamp,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} ${errorText}`);
    }

    const json = await response.json();

    return {
      timestamp: json.timestamp,
      fakeProbability: json.fakeProbability,
      confidence: json.confidence,
      reasoning: json.reasoning,
    };
  } catch (error) {
    console.error("Local API Analysis Error:", error);
    return {
      timestamp,
      fakeProbability: 0,
      confidence: "Offline",
      reasoning: "Failed to connect to local detection server.",
    };
  }
};

/**
 * Direct Gemini API call using the official unified @google/genai client.
 * Audits a WAV segment for synthetic anomalies using Gemini's native audio understanding.
 */
export const performForensicAudit = async (
  base64WavData: string,
  apiKey: string
): Promise<ForensicAuditReport> => {
  if (!apiKey) {
    throw new Error("API key is required for Gemini Audit.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are a forensic audio engineer specializing in speech synthesis, voice cloning, and deepfake verification.
Analyze this raw voice recording for indications of artificial origin (e.g. generative AI cloning, text-to-speech, or robotic vocoding).

Evaluate these areas:
1. Prosody & Phrasing: Look for unnatural micro-pauses, flat stress distribution, lack of breath pauses, or mechanical intonation.
2. Acoustic/Spectral Clues: Listen/inspect for phase discrepancies, metallic ringing, vocoder sub-carrier buzz, spectral gaps, or digital noise gating.
3. Decision: Assign a final verdict:
   - "Authentic" (Natural human voice, organic pauses/breath, complex pitch contours).
   - "Suspicious" (Organic base but exhibits digital degradation, compression, or mild splicing).
   - "Synthetic / Cloned" (Generative AI voice clone, matching target intonation but exhibiting vocoder/diffusion glitches).
   - "Robotic / TTS" (Traditional rule-based or concatenative speech synth, flat-pitch drone).

You MUST respond strictly in valid JSON matching this schema:
{
  "verdict": "Authentic" | "Suspicious" | "Synthetic / Cloned" | "Robotic / TTS",
  "confidenceScore": number, // an integer from 0 to 100
  "prosodyAnalysis": "detailed analysis of flow, prosody, and tempo",
  "anomalyAnalysis": "detailed analysis of spectral, vocoder, or phase artifacts",
  "forensicBreakdown": "final technical summary explaining why this verdict was chosen"
}

Do not wrap the JSON output in markdown blocks or include any extra text. Return only the JSON string.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: base64WavData
              }
            },
            {
              text: prompt
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text?.trim() || '{}';
    const cleanText = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    const data = JSON.parse(cleanText);

    return {
      verdict: data.verdict || 'Suspicious',
      confidenceScore: data.confidenceScore || 50,
      prosodyAnalysis: data.prosodyAnalysis || 'Analysis not generated.',
      anomalyAnalysis: data.anomalyAnalysis || 'Acoustic anomalies check inconclusive.',
      forensicBreakdown: data.forensicBreakdown || 'No breakdown provided.',
      rawResponse: text
    };
  } catch (error) {
    console.error("Gemini Forensic Audit API call crashed:", error);
    throw error;
  }
};