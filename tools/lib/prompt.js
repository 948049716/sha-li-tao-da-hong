'use strict';
/** 统一的提示词拼装：画风前缀（锁定图1/图2）+ 品类模板 + 资产主体描述。手册、校验与批量生图共用，保证三处完全一致。 */
const crypto = require('crypto');

function buildPrompt(asset, lib) {
  const tpl = lib.templates[asset.category];
  if (!tpl) throw new Error(`资产 ${asset.assetId} 的品类 ${asset.category} 没有模板`);
  const rar = asset.rarity ? lib.rarityLooks[asset.rarity] : null;
  const body = tpl.body
    .replace('{subject}', asset.subject)
    .replace('{rarityColor}', rar ? rar.color : '')
    .replace('{rarityLook}', rar ? rar.look : '');
  const positive = `${lib.stylePreset.prefix}\n${body}`;
  const negative = lib.stylePreset.negative + (asset.extraNegative ? `, ${asset.extraNegative}` : '');
  const size = asset.size || tpl.size;
  const seed = asset.seed != null ? asset.seed : parseInt(crypto.createHash('md5').update(asset.assetId).digest('hex').slice(0, 8), 16) % 2147483647;
  const promptHash = crypto.createHash('sha1').update(positive + '|' + negative + '|' + size.join('x') + '|' + seed).digest('hex').slice(0, 12);
  return { positive, negative, width: size[0], height: size[1], seed, promptHash };
}

/** ComfyUI + Qwen-Image-2.1 工作流（图1=风格参考图，图2=主图，可选） */
function buildComfyWorkflow(asset, lib, opts = {}) {
  const p = buildPrompt(asset, lib);
  const enc = { prompt: p.positive, negative_prompt: p.negative, resolution: 768, clip: ['2', 0], vae: ['3', 0], 'images.image_1': ['9', 0] };
  const wf = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    9: { class_type: 'LoadImage', inputs: { image: lib.styleAnchors.image_1.file } },
    4: { class_type: 'TextEncodeQwenImage21', inputs: enc },
    5: { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    6: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['4', 1], latent_image: ['5', 0], seed: p.seed, steps: 28, cfg: 4.2, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    8: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: asset.assetId } }
  };
  if (opts.useKeyArt) {
    wf[10] = { class_type: 'LoadImage', inputs: { image: lib.styleAnchors.image_2.file } };
    enc['images.image_2'] = ['10', 0];
  }
  return { workflow: wf, meta: p };
}

module.exports = { buildPrompt, buildComfyWorkflow };
