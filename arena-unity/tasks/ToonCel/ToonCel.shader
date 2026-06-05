// ToonCel.shader — Unity 6 URP, HLSL custom toon/cel shading
// Passes: ForwardLit (toon lighting) + Outline (normal-extrusion backface)
// Drop into Assets/Shaders/ToonCel/ to use.

Shader "RadiantArena/ToonCel"
{
    Properties
    {
        [Header(Base)]
        _BaseColor      ("Base Color",      Color)  = (1, 1, 1, 1)
        _BaseMap        ("Base Map",        2D)     = "white" {}

        [Header(Shading)]
        _ShadowStrength ("Shadow Strength", Range(0,1)) = 0.5
        [IntRange]
        _DiffuseSteps   ("Diffuse Steps",   Range(2,5)) = 3

        [Header(Specular)]
        _SpecularColor      ("Specular Color",      Color)  = (1,1,1,1)
        _SpecularSize       ("Specular Size",        Range(0,1)) = 0.15
        _SpecularSmoothness ("Specular Smoothness",  Range(0,0.5)) = 0.05

        [Header(Rim)]
        _RimColor     ("Rim Color",      Color)        = (0.8,0.9,1,1)
        _RimPower     ("Rim Power",      Range(1,10))  = 4.0
        _RimThreshold ("Rim Threshold",  Range(-1,1))  = 0.1

        [Header(Outline)]
        _OutlineColor     ("Outline Color",   Color)       = (0,0,0,1)
        _OutlineThickness ("Outline Width",   Range(0,0.05)) = 0.005

        [Header(Alpha)]
        [Enum(UnityEngine.Rendering.CullMode)]
        _Cull ("Cull", Float) = 2  // Back
    }

    SubShader
    {
        Tags
        {
            "RenderType"      = "Opaque"
            "RenderPipeline"  = "UniversalPipeline"
            "Queue"           = "Geometry"
        }

        // ─────────────────────────────────────────────
        // PASS 1 — Forward Lit (toon shading)
        // ─────────────────────────────────────────────
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull [_Cull]

            HLSLPROGRAM
            #pragma vertex   ToonVert
            #pragma fragment ToonFrag

            // URP keywords
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _SHADOWS_SOFT
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "ToonCelLighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _BaseMap_ST;
                float  _ShadowStrength;
                int    _DiffuseSteps;
                float4 _SpecularColor;
                float  _SpecularSize;
                float  _SpecularSmoothness;
                float4 _RimColor;
                float  _RimPower;
                float  _RimThreshold;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS  : SV_POSITION;
                float2 uv          : TEXCOORD0;
                float3 normalWS    : TEXCOORD1;
                float3 positionWS  : TEXCOORD2;
                float3 viewDirWS   : TEXCOORD3;
                float4 shadowCoord : TEXCOORD4;
                float  fogFactor   : TEXCOORD5;
            };

            Varyings ToonVert(Attributes IN)
            {
                Varyings OUT;
                VertexPositionInputs posInputs  = GetVertexPositionInputs(IN.positionOS.xyz);
                VertexNormalInputs   normInputs = GetVertexNormalInputs(IN.normalOS);

                OUT.positionCS  = posInputs.positionCS;
                OUT.positionWS  = posInputs.positionWS;
                OUT.normalWS    = normInputs.normalWS;
                OUT.viewDirWS   = GetWorldSpaceNormalizeViewDir(posInputs.positionWS);
                OUT.uv          = TRANSFORM_TEX(IN.uv, _BaseMap);
                OUT.shadowCoord = GetShadowCoord(posInputs);
                OUT.fogFactor   = ComputeFogFactor(posInputs.positionCS.z);
                return OUT;
            }

            half4 ToonFrag(Varyings IN) : SV_Target
            {
                float4 baseColor = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, IN.uv) * _BaseColor;

                ToonLightingData lightData;
                lightData.normalWS        = normalize(IN.normalWS);
                lightData.viewDirWS       = normalize(IN.viewDirWS);
                lightData.positionWS      = IN.positionWS;
                lightData.albedo          = baseColor.rgb;
                lightData.rimColor        = _RimColor.rgb;
                lightData.rimPower        = _RimPower;
                lightData.rimThreshold    = _RimThreshold;
                lightData.specularColor   = _SpecularColor.rgb;
                lightData.specularSize    = _SpecularSize;
                lightData.specularSmoothness = _SpecularSmoothness;
                lightData.shadowStrength  = _ShadowStrength;
                lightData.shadowCoord     = IN.shadowCoord;

                float3 color = CalcToonLighting(lightData);
                color = MixFog(color, IN.fogFactor);
                return half4(color, baseColor.a);
            }
            ENDHLSL
        }

        // ─────────────────────────────────────────────
        // PASS 2 — Outline (backface normal extrusion)
        // ─────────────────────────────────────────────
        Pass
        {
            Name "Outline"
            Tags { "LightMode" = "SRPDefaultUnlit" }
            Cull Front   // render backfaces only

            HLSLPROGRAM
            #pragma vertex   OutlineVert
            #pragma fragment OutlineFrag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _OutlineColor;
                float  _OutlineThickness;
                // (other props in same CBUFFER — must match ForwardLit block)
                float4 _BaseColor;
                float4 _BaseMap_ST;
                float  _ShadowStrength;
                int    _DiffuseSteps;
                float4 _SpecularColor;
                float  _SpecularSize;
                float  _SpecularSmoothness;
                float4 _RimColor;
                float  _RimPower;
                float  _RimThreshold;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
            };

            Varyings OutlineVert(Attributes IN)
            {
                Varyings OUT;
                // Expand along normal in clip space — stable at any distance
                float3 normalWS = TransformObjectToWorldNormal(IN.normalOS);
                float4 posCS    = TransformObjectToHClip(IN.positionOS.xyz);

                // Offset in clip-space normal direction (screen-space consistent width)
                float2 normalCS = TransformWorldToHClipDir(normalWS).xy;
                float  aspect   = _ScreenParams.y / _ScreenParams.x;
                normalCS.x     *= aspect;
                normalCS        = normalize(normalCS);

                posCS.xy += normalCS * (_OutlineThickness * posCS.w);
                OUT.positionCS = posCS;
                return OUT;
            }

            half4 OutlineFrag(Varyings IN) : SV_Target
            {
                return _OutlineColor;
            }
            ENDHLSL
        }

        // Shadow caster pass (URP built-in)
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
        UsePass "Universal Render Pipeline/Lit/DepthOnly"
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
    CustomEditor "UnityEditor.Rendering.Universal.ShaderGUI.LitShader"
}
