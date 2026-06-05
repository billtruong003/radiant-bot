#ifndef TOON_CEL_LIGHTING_INCLUDED
#define TOON_CEL_LIGHTING_INCLUDED

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

// --- Configurable steps ---
// DIFFUSE_STEPS: how many shading bands (2 = 2-tone, 3 = 3-tone)
#ifndef DIFFUSE_STEPS
    #define DIFFUSE_STEPS 3
#endif

// Quantize [0,1] → N equal steps
float StepQuantize(float value, int steps)
{
    return floor(value * steps) / (steps - 1.0);
}

// Soft step threshold (replaces hard step to reduce aliasing at grazing)
float SmoothThreshold(float value, float threshold, float smoothness)
{
    return smoothstep(threshold - smoothness, threshold + smoothness, value);
}

struct ToonLightingData
{
    float3 normalWS;
    float3 viewDirWS;
    float3 positionWS;
    float3 albedo;
    float3 rimColor;
    float  rimPower;
    float  rimThreshold;
    float3 specularColor;
    float  specularSize;       // 0..1 smaller = tighter highlight
    float  specularSmoothness; // edge softness
    float  shadowStrength;
    float4 shadowCoord;
};

// --- Rim light (Fresnel) ---
float3 CalcRim(ToonLightingData d, Light light)
{
    float rim = 1.0 - saturate(dot(d.viewDirWS, d.normalWS));
    float rimDot = pow(rim, d.rimPower);
    float rimIntensity = rimDot * SmoothThreshold(dot(d.normalWS, light.direction), d.rimThreshold, 0.02);
    return rimIntensity * d.rimColor * light.color;
}

// --- Toon specular (Blinn-Phong quantized) ---
float3 CalcSpecular(ToonLightingData d, Light light)
{
    float3 halfDir = normalize(light.direction + d.viewDirWS);
    float  NdotH   = saturate(dot(d.normalWS, halfDir));
    float  specVal = pow(NdotH, max(0.01, (1.0 - d.specularSize) * 512.0));
    float  toon    = smoothstep(0.5 - d.specularSmoothness, 0.5 + d.specularSmoothness, specVal);
    return toon * d.specularColor * light.color;
}

// --- Stepped diffuse ---
float3 CalcDiffuse(ToonLightingData d, Light light)
{
    float NdotL = dot(d.normalWS, light.direction);
    // shadow attenuation baked into NdotL
    float attenuation = light.distanceAttenuation * light.shadowAttenuation;
    NdotL = saturate(NdotL * attenuation);

    float toonDiff = StepQuantize(NdotL, DIFFUSE_STEPS);
    return toonDiff * d.albedo * light.color;
}

// --- Full toon lighting (main light + additive lights) ---
float3 CalcToonLighting(ToonLightingData d)
{
    // Ambient (SH from URP)
    float3 ambient = SampleSH(d.normalWS) * d.albedo;

    // Main directional light
    Light mainLight = GetMainLight(d.shadowCoord, d.positionWS, half4(1,1,1,1));

    float3 color = ambient
                 + CalcDiffuse(d, mainLight)
                 + CalcSpecular(d, mainLight)
                 + CalcRim(d, mainLight);

    // Additional lights (point / spot, no shadow for toon simplicity)
    int additionalLightCount = GetAdditionalLightsCount();
    for (int i = 0; i < additionalLightCount; i++)
    {
        Light addLight = GetAdditionalLight(i, d.positionWS, half4(1,1,1,1));
        color += CalcDiffuse(d, addLight) * 0.5; // weaker additive contribution
    }

    return color;
}

#endif // TOON_CEL_LIGHTING_INCLUDED
