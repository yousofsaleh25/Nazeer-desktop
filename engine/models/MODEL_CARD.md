# Model card — Nazeer camel body segmenter (body_seg v3)

> **Status:** proposed pin, waiting for decision D1 (`best.pt` recommended).
> **Rule:** the engine loads this model only if the file's sha256 equals the value below.
> **Last verified:** 2026-10-04, against `E:\camel_beauty` and probes run on the RTX A3000 laptop.

## 1. Identity

| Field | Value |
|---|---|
| Name | Nazeer camel body segmenter |
| Version | body_seg v3, checkpoint `best.pt` (epoch 72) |
| File in this repo | `engine/models/body_seg_v3_best.pt` (renamed from `best.pt`; the hash identifies it, not the name) |
| sha256 | `0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320` |
| Size | 6,008,925 bytes |
| Source | `camel_beauty/models/body_seg/v3/best.pt` |
| Training run | `20260507_163616_8ea83a9a` (`body_seg_v3_production`), 2026-05-07 |
| Architecture | YOLO11n-seg (`yolo11n-seg.yaml`), instance segmentation, fine-tuned from the COCO-pretrained `yolo11n-seg.pt` |
| Size of network | 2,842,803 parameters; 9.73 GFLOPs at 640; strides 8 / 16 / 32 |
| Classes | 1: `{0: "camel"}` |
| Framework | Ultralytics 8.4.47. Trained with PyTorch 2.3.0 + CUDA 12.1 on an AWS SageMaker Tesla T4; inference verified with PyTorch 2.11.0 |
| Owner | Youssef Saleh, Nazeer |
| Licence | AGPL-3.0, inherited from Ultralytics. A closed-source commercial build needs an Ultralytics Enterprise License (decision D6, open) |

## 2. Intended use

- **What it does:** finds the one camel in a single D455 colour frame (side or end view) and returns its mask, bounding box and confidence.
- **What the mask feeds:** the reference depth (Z_ref = median valid depth inside the mask), the ground reference line (lowest mask row), and the overlay the judge sees.
- **Who uses it:** the Nazeer engine only. The operator always sees the mask and can reject it.
- **Out of scope:** beauty scoring or ranking, identifying individual camels, health or age assessment, counting several animals, other species, and any use without a person reviewing the mask.

## 3. Inference contract

| Setting | Value | Why |
|---|---|---|
| Input | BGR `uint8` H×W×3, true colours. The bag stores **rgb8**: convert once, in the bag reader | The old pipeline fed swapped colours (blue camel) |
| Resolution | Letterboxed to 640 on the long side; a 1280×720 frame runs as a 640×384 tensor | Training `imgsz` = 640 |
| Confidence | `conf=0.5` | Below this the mask was judged unreliable |
| Detections used | The highest-confidence one only. None → a rejection with a reason, never an empty mask | Single-camel sessions |
| Masks | `retina_masks=True` | Native-resolution mask. Resizing the 384×640 low-res mask without removing its 12 px padding squeezed it ~6 % (IoU 0.881) |
| Output | Mask H×W `uint8` 0/255 aligned to the input frame, bbox `xyxy` in pixels, confidence | |
| Integrity | sha256 checked before loading; a mismatch stops the engine with a clear error | One known model behind every number |

**Reference behaviour** — canonical frame (bag `20260414_175757-006`, frame 180, 1280×720, true colours, retina masks). Use as golden-test values with tolerances of ±1 % mask pixels and ±0.01 confidence.

| Checkpoint | Confidence | Mask pixels | Mask rows (y) | CPU time per frame |
|---|---|---|---|---|
| `best.pt` (pinned) | 0.959 | 269,033 | 9–715 | 46.0 ms |
| `last.pt` (alternative) | 0.965 | 269,677 | 11–712 | 47.6 ms |

GPU time on the RTX A3000 Laptop: 11.7 ms per frame with retina masks (measured with `last.pt`; both checkpoints share the same architecture).

## 4. Training data

- **191 labelled still photos** of camels with polygon masks (YOLO format): 152 train, 39 val. From the team's `custom_instance_dataset`, body images only (the face images in the same dataset are excluded).
- **No identity overlap:** one image per camel ID (for example `100B_Body_seg_1.png`); no ID appears in both splits.
- **Not D455 frames:** sizes vary from 228 to 2,891 px wide (median 1,048) and 265 to 2,592 px high (median 968); aspect ratio 0.37–2.54; 125 of 191 are landscape; none is 1280×720.
- **Split files:** `manifests/train_body.txt`, `manifests/val_body.txt`. These manifests replaced a folder layout that leaked unlabelled images into validation (see the lineage in section 6).
- **Licence and provenance of the photos:** unknown. Open item before any commercial use.

## 5. Training setup

| Setting | Value |
|---|---|
| Schedule | 100 epochs, patience 30, batch 16, imgsz 640; best epoch 72, chosen by mask mAP50-95 |
| Optimiser | AdamW, lr0 0.001 → lrf 0.01, cosine schedule, 3 warm-up epochs, weight decay 0.0005 |
| Augmentation | HSV 0.015 / 0.7 / 0.5, rotation ±5°, translate 0.1, scale 0.5, horizontal flip 0.5, mosaic 0.6 (off for the last 20 epochs), mixup 0.1, copy-paste 0.1, RandAugment, random erasing 0.4 |
| Reproducibility | seed 42, deterministic, AMP on |
| Config | `configs/train/body_seg_v3_production.yaml`, sha256 `8ea83a9aa1f4704fc2f4f1f8bdeae16af88b6c072891be157ba084f4974f6a78` |

## 6. Evaluation

| Validation metric (39 images) | `best.pt` (epoch 72) | `last.pt` (epoch 100) |
|---|---|---|
| Mask mAP50-95 | 0.895 | 0.879 |
| Mask mAP50 | 0.995 | 0.995 |
| Box mAP50-95 | 0.988 | 0.992 |
| Mask precision / recall | 0.999 / 1.000 | 0.999 / 1.000 |

- The post-training validation of `best.pt` reports mask mAP50-95 0.896 (`models/body_seg/v3/REPORT.md`).
- **5-fold cross-validation** with the same hyperparameters gave mask mAP50-95 **0.854 ± 0.020**. This is the more honest estimate of how well it generalises.
- **Read with care:** 39 validation photos from the same distribution as training. mAP50 = 0.995 means the model finds the camel; it does not mean the edges are exact. There is no test set, and no evaluation on D455 frames with ground-truth masks yet.

Lineage (same base model, same day):

| Folder | Run | Config | Mask mAP50-95 | Note |
|---|---|---|---|---|
| `v1` | `20260507_030440_19093e49` | `body_seg_v2.yaml` | 0.273 | Invalid: validation folder held 143 mixed images but only 39 labels (precision 0.21) |
| `v2` | `20260507_133413_325ebd93` | `body_seg_v3_base.yaml` | 0.883 | 60-epoch base after the manifest fix |
| `v3` | `20260507_163616_8ea83a9a` | `body_seg_v3_production.yaml` | 0.896 | **This model** |

## 7. Limitations and risks

1. **Small, narrow data.** 191 photos and no D455 frames. Expect failures with new venues, dusk or night light, unusual coat colours, dust and partial views.
2. **People and gear.** Handlers, ropes, saddles or a second camel touching the animal can be merged into the mask or cut out of it. The operator reviews every mask.
3. **Edges drive measurements.** The ground line (lowest mask row) and Z_ref (mask-median depth) both come from the mask boundary. Every 2D distance scales with Z_ref, and a mask that leaks onto the ground shifts it.
4. **Earlier numbers are suspect.** The old pipeline swapped colours and stretched the padded low-res mask. On the canonical frame, a height line ending on its ground line (row 693) read 1.996 m. Ending at the native mask's lowest row gives 2.051 m on the same input (row 711), and 2.063 m with true colours and `best.pt` (row 715), all at Z_ref 1.930 m.

## 8. Verify the file

```powershell
Get-FileHash engine\models\body_seg_v3_best.pt -Algorithm SHA256
```

```python
import hashlib, pathlib
print(hashlib.sha256(pathlib.Path("engine/models/body_seg_v3_best.pt").read_bytes()).hexdigest())
```

Expected: `0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320`

## 9. Open items

- [ ] Confirm D1 (`best.pt` vs `last.pt`) and change the status line at the top.
- [ ] Decide D6: Ultralytics Enterprise License, open-source under AGPL, or a permissively licensed model.
- [ ] Record the source and licence of the 191 training photos.
- [ ] Field check: label at least 30 D455 frames from the six bags; report mask IoU and ground-row error in pixels.
- [ ] Colour check: validate on the 39 val images as stored and with red and blue swapped.

## 10. Changelog

| Date | Change |
|---|---|
| 2026-10-04 | Card created for Nazeer Desktop. Facts read from `camel_beauty` (checkpoints, `REPORT.md`, `metrics.json`, `env.txt`, configs, manifests) and from probes in `runs/electron_mvp_probe/` |
