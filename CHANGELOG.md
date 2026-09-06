# Changelog

## Releases 2.0.0 and Later

From version 2.0.0 onward, release notes are published on the [GitHub Releases page](https://github.com/intent-hq/cloudlands-releases/releases). Auto-generated entries for 2.x releases also appear below.

## [2.138.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.138.3...v2.138.4) (2026-09-06)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.29 ([#2223](https://github.com/intent-hq/cloudlands-fe/issues/2223)) ([0ef8a4a](https://github.com/intent-hq/cloudlands-fe/commit/0ef8a4aca1b11609c04caec19365f07d0c0f432e))


### ⚡ Performance

* tier workspace hydration and stage chat rendering (load-path batch C) ([#2120](https://github.com/intent-hq/cloudlands-fe/issues/2120)) ([3d1806f](https://github.com/intent-hq/cloudlands-fe/commit/3d1806f8407a9dae6d35e629f3181843a4fb0922))

## [2.138.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.138.2...v2.138.3) (2026-09-06)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.28 ([#2218](https://github.com/intent-hq/cloudlands-fe/issues/2218)) ([7e768ca](https://github.com/intent-hq/cloudlands-fe/commit/7e768ca89836b2678dde30903beaac0a1b82a7cb))


### ⚡ Performance

* dedupe load-path RPCs and fix chat/file saga bugs ([#2113](https://github.com/intent-hq/cloudlands-fe/issues/2113)) ([028b1e0](https://github.com/intent-hq/cloudlands-fe/commit/028b1e039bb718d5a42ab4a6377fc24f2c347001))

## [2.138.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.138.1...v2.138.2) (2026-09-06)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.27 ([#2214](https://github.com/intent-hq/cloudlands-fe/issues/2214)) ([4bfdeb3](https://github.com/intent-hq/cloudlands-fe/commit/4bfdeb3c352fb154ad1149dbbefb77a5357396e1))

## [2.138.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.138.0...v2.138.1) (2026-09-06)


### 🐛 Bug Fixes

* **daemon-health:** explain degraded status and recover after successful checks ([#2212](https://github.com/intent-hq/cloudlands-fe/issues/2212)) ([62169ac](https://github.com/intent-hq/cloudlands-fe/commit/62169ac5a854718f563c25dd06657a075ba6fdac))

## [2.138.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.137.2...v2.138.0) (2026-09-05)


### 🚀 Features

* **terminal:** reopen terminals in their last placement ([#2204](https://github.com/intent-hq/cloudlands-fe/issues/2204)) ([eb222d5](https://github.com/intent-hq/cloudlands-fe/commit/eb222d5d23d0ba7a69a985bdaefeb620aef4dbcf))

## [2.137.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.137.1...v2.137.2) (2026-09-05)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.26 ([#2209](https://github.com/intent-hq/cloudlands-fe/issues/2209)) ([27c9aa1](https://github.com/intent-hq/cloudlands-fe/commit/27c9aa1e5eec60814b430781c562d872d9c425ef))

## [2.137.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.137.0...v2.137.1) (2026-09-05)


### 🐛 Bug Fixes

* **hud:** gate background agents from the summary isBackground flag ([#2111](https://github.com/intent-hq/cloudlands-fe/issues/2111)) ([89e8460](https://github.com/intent-hq/cloudlands-fe/commit/89e8460b17ef3646bb7b930ed0a867c7ffe0e594))

## [2.137.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.136.3...v2.137.0) (2026-09-05)


### 🚀 Features

* add guided Antigravity connection flow ([#2192](https://github.com/intent-hq/cloudlands-fe/issues/2192)) ([a74e201](https://github.com/intent-hq/cloudlands-fe/commit/a74e201c42a0ae27f2eef4942cb6be91c6a1ce84))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.25 ([#2200](https://github.com/intent-hq/cloudlands-fe/issues/2200)) ([5f95ecd](https://github.com/intent-hq/cloudlands-fe/commit/5f95ecdecb1c565996a41d202ba89350cadb754a))

## [2.136.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.136.2...v2.136.3) (2026-09-05)


### 🐛 Bug Fixes

* **agent-avatar:** route inline/attribution/mention avatars through shared runtime-state precedence ([#2108](https://github.com/intent-hq/cloudlands-fe/issues/2108)) ([d75a570](https://github.com/intent-hq/cloudlands-fe/commit/d75a570abcb2e0e02a8999d1126662d5520b2c61))
* never install the dev browser mock inside an Electron renderer ([#2106](https://github.com/intent-hq/cloudlands-fe/issues/2106)) ([e22a9bc](https://github.com/intent-hq/cloudlands-fe/commit/e22a9bc1a1870cdb295fdf7ded451347b24c6ac6))
* surface secret-unavailable connection opens in all callers ([#2110](https://github.com/intent-hq/cloudlands-fe/issues/2110)) ([3ed9e7c](https://github.com/intent-hq/cloudlands-fe/commit/3ed9e7c176448209923b1310b9a2286c11318321))

## [2.136.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.136.1...v2.136.2) (2026-09-04)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.24 ([#2193](https://github.com/intent-hq/cloudlands-fe/issues/2193)) ([b175923](https://github.com/intent-hq/cloudlands-fe/commit/b175923bce8ee6dfb5f9aeb6998d5f5cfceff1e9))

## [2.136.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.136.0...v2.136.1) (2026-09-04)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.23 ([#2184](https://github.com/intent-hq/cloudlands-fe/issues/2184)) ([03470d6](https://github.com/intent-hq/cloudlands-fe/commit/03470d6df35c06c5c777fba08919d2d2f9d81a0f))
* **chat:** do not commit the empty-chat entry while the transcript is hydrating ([#2178](https://github.com/intent-hq/cloudlands-fe/issues/2178)) ([94404aa](https://github.com/intent-hq/cloudlands-fe/commit/94404aac268ee23479caf8607ad560ebeb03207e))
* **main:** route workspace-file requests by requesting window backend and cache-bust images ([#2180](https://github.com/intent-hq/cloudlands-fe/issues/2180)) ([70e674a](https://github.com/intent-hq/cloudlands-fe/commit/70e674a7777da182184e75707596abaf700348e6))
* **model-picker:** keep focus on the effort trigger after a committed change ([#2179](https://github.com/intent-hq/cloudlands-fe/issues/2179)) ([b772576](https://github.com/intent-hq/cloudlands-fe/commit/b7725760a38af5cea27571f4f6139ce8955de34c))

## [2.136.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.135.0...v2.136.0) (2026-09-04)


### 🚀 Features

* add device icon picker ([#2130](https://github.com/intent-hq/cloudlands-fe/issues/2130)) ([9f176b7](https://github.com/intent-hq/cloudlands-fe/commit/9f176b73a259728cef1f839d1ad000bb55701a5e))
* add same-origin intentd dev bridge for dev:web ([#2061](https://github.com/intent-hq/cloudlands-fe/issues/2061)) ([e86c1bf](https://github.com/intent-hq/cloudlands-fe/commit/e86c1bf08488fe5001cdb74798598cef697ddded))
* render agent proposals inline in the chat transcript ([#2050](https://github.com/intent-hq/cloudlands-fe/issues/2050)) ([47b5815](https://github.com/intent-hq/cloudlands-fe/commit/47b5815c7fbeb4f398c44f6f1e0dd978fe341aac))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.21 ([#2176](https://github.com/intent-hq/cloudlands-fe/issues/2176)) ([44fcc66](https://github.com/intent-hq/cloudlands-fe/commit/44fcc662e4eb90c7b92a208436e752c010804a74))

## [2.135.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.134.0...v2.135.0) (2026-09-04)


### 🚀 Features

* persist connection device kinds ([#2128](https://github.com/intent-hq/cloudlands-fe/issues/2128)) ([03d7a69](https://github.com/intent-hq/cloudlands-fe/commit/03d7a695e11e61cccef17d8a50bc55354396bac6))
* **settings:** add ACP Node heap limit control to Agent Backend ([#2118](https://github.com/intent-hq/cloudlands-fe/issues/2118)) ([c601e9d](https://github.com/intent-hq/cloudlands-fe/commit/c601e9da009895abffbd844e1723a17d9e3cec4c))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.19 ([#2170](https://github.com/intent-hq/cloudlands-fe/issues/2170)) ([b283a9f](https://github.com/intent-hq/cloudlands-fe/commit/b283a9f711143f67e2c5be1a603023ae27510615))
* bump intentd sidecar to v0.9.20 ([#2174](https://github.com/intent-hq/cloudlands-fe/issues/2174)) ([2e9ed8e](https://github.com/intent-hq/cloudlands-fe/commit/2e9ed8e34810ed7a3d4c11dce113d8cf63ebd6f2))
* live-update sidebar task status icons on task:status-changed ([#2173](https://github.com/intent-hq/cloudlands-fe/issues/2173)) ([c53c452](https://github.com/intent-hq/cloudlands-fe/commit/c53c45272fb92dc1998c80782cdcdb2986bef288))
* **settings:** follow the daemon-acknowledged ACP heap value as the retry baseline ([#2172](https://github.com/intent-hq/cloudlands-fe/issues/2172)) ([29289d1](https://github.com/intent-hq/cloudlands-fe/commit/29289d1dbb7ea2244788846ba4df92ae3438bfd4))

## [2.134.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.133.0...v2.134.0) (2026-09-04)


### 🚀 Features

* **workspace:** warn about unpushed and uncommitted changes when archiving or deleting a workspace ([#2152](https://github.com/intent-hq/cloudlands-fe/issues/2152)) ([4f5cc02](https://github.com/intent-hq/cloudlands-fe/commit/4f5cc02c42f612b78996678003ad1fa79bc12716))


### 🐛 Bug Fixes

* stop warning npx missing for claude-code when a path override is in use ([#2166](https://github.com/intent-hq/cloudlands-fe/issues/2166)) ([084f8a6](https://github.com/intent-hq/cloudlands-fe/commit/084f8a6cb6f717aab43f26020b48b6b47dc29531))

## [2.133.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.132.0...v2.133.0) (2026-09-04)


### 🚀 Features

* **tooltip:** GitHub issue/PR hover cards in the link tooltip ([#2153](https://github.com/intent-hq/cloudlands-fe/issues/2153)) ([922a2c4](https://github.com/intent-hq/cloudlands-fe/commit/922a2c42de16fb165e7d5206fb4673184ce7f9d1))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.18 ([#2168](https://github.com/intent-hq/cloudlands-fe/issues/2168)) ([edb5fc3](https://github.com/intent-hq/cloudlands-fe/commit/edb5fc32193a53f9771465c1a34658c833a08772))
* **ct:** isolate the zoom-200% geometry spec and record CDP lifecycle on mount flakes ([#2158](https://github.com/intent-hq/cloudlands-fe/issues/2158)) ([119d3ef](https://github.com/intent-hq/cloudlands-fe/commit/119d3ef7de8c81fa7043a55ebf5c9c118c518328))
* **settings:** describe claude-code path override truthfully and keep picked symlinks unresolved ([#2162](https://github.com/intent-hq/cloudlands-fe/issues/2162)) ([130eee0](https://github.com/intent-hq/cloudlands-fe/commit/130eee0bee52d34c9537d0801e62423ef92016fd))
* **stream:** carry interruptReason/interruptedBy through live stream:end ([#2155](https://github.com/intent-hq/cloudlands-fe/issues/2155)) ([ce42abb](https://github.com/intent-hq/cloudlands-fe/commit/ce42abb755ad839ec3d9d15c9a6c44945c110866))

## [2.132.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.131.0...v2.132.0) (2026-09-04)


### 🚀 Features

* **daemon-status:** show an Updating intentd countdown overlay before the stopped overlay after a requested daemon update ([#2151](https://github.com/intent-hq/cloudlands-fe/issues/2151)) ([1f15ee7](https://github.com/intent-hq/cloudlands-fe/commit/1f15ee7a591b93c68b7eed52bb26fde034593113))
* **sidebar:** show Queued state label for merge-queued PR rows ([#2141](https://github.com/intent-hq/cloudlands-fe/issues/2141)) ([10436b1](https://github.com/intent-hq/cloudlands-fe/commit/10436b1192e3af2ae72401f04eaf2f496cfca668))


### 🐛 Bug Fixes

* align chat spacing to panel width ([#2132](https://github.com/intent-hq/cloudlands-fe/issues/2132)) ([8fd2691](https://github.com/intent-hq/cloudlands-fe/commit/8fd2691cdee2915f2aecf1c23245eee8caca7860))
* **browser:** single-line address identity in toolbar ([#2112](https://github.com/intent-hq/cloudlands-fe/issues/2112)) ([6829826](https://github.com/intent-hq/cloudlands-fe/commit/68298265eeebf4f900f3a8ced72971710ce39ab0))
* bump intentd sidecar to v0.9.16 ([#2148](https://github.com/intent-hq/cloudlands-fe/issues/2148)) ([7d24705](https://github.com/intent-hq/cloudlands-fe/commit/7d247056a7d5ed45012251e248cb5003321f1785))
* bump intentd sidecar to v0.9.17 ([#2157](https://github.com/intent-hq/cloudlands-fe/issues/2157)) ([80db373](https://github.com/intent-hq/cloudlands-fe/commit/80db373373039ba6124d2222fb7d59134603d9e7))
* **ci:** revalidate intentd pin against live main before publishing the rolling PR ([#2139](https://github.com/intent-hq/cloudlands-fe/issues/2139)) ([dca3058](https://github.com/intent-hq/cloudlands-fe/commit/dca30582736ae6f524d6a3a920d5b48232a0d254))
* fail browser screenshot instead of returning an empty image ([#2131](https://github.com/intent-hq/cloudlands-fe/issues/2131)) ([5bbf41b](https://github.com/intent-hq/cloudlands-fe/commit/5bbf41b92e1ed9a8785509ee41ad129b8eb32a7a))
* keep the Q&A wizard visible across later turns ([#2136](https://github.com/intent-hq/cloudlands-fe/issues/2136)) ([5fb0ed4](https://github.com/intent-hq/cloudlands-fe/commit/5fb0ed433d0dd1545f3307da1a4a70b62249b32a))
* prevent nested reasoning picker overflow ([#2067](https://github.com/intent-hq/cloudlands-fe/issues/2067)) ([786eaa0](https://github.com/intent-hq/cloudlands-fe/commit/786eaa029463aadb168969682056e10ba035d60a))
* rename "Queued to merge" status label to "PR Queued" ([#2140](https://github.com/intent-hq/cloudlands-fe/issues/2140)) ([998d775](https://github.com/intent-hq/cloudlands-fe/commit/998d77579f1190915396619c640f0174eb2a6238))
* **workspace:** refine hover card density ([#2126](https://github.com/intent-hq/cloudlands-fe/issues/2126)) ([911453a](https://github.com/intent-hq/cloudlands-fe/commit/911453a2f12611c280c509cd9421a16a1f7dc7da))

## [2.131.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.130.1...v2.131.0) (2026-09-04)


### 🚀 Features

* add opt-in Antigravity provider setup ([#2056](https://github.com/intent-hq/cloudlands-fe/issues/2056)) ([3c4fea8](https://github.com/intent-hq/cloudlands-fe/commit/3c4fea8a5c48a7294bc6e9a6b631fe39efe3224a))
* **sidebar:** replace the single View PR link with a PR dropdown on the Changes launcher ([#2117](https://github.com/intent-hq/cloudlands-fe/issues/2117)) ([55bd899](https://github.com/intent-hq/cloudlands-fe/commit/55bd899bf4489067aaaccc1899c73bc1031c68a1))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.14 ([#2133](https://github.com/intent-hq/cloudlands-fe/issues/2133)) ([8670cbb](https://github.com/intent-hq/cloudlands-fe/commit/8670cbb32f1bce94cb558e71a0ce2e663a7323c4))
* bump intentd sidecar to v0.9.15 ([#2137](https://github.com/intent-hq/cloudlands-fe/issues/2137)) ([39accc2](https://github.com/intent-hq/cloudlands-fe/commit/39accc244b5c2fa41168d9b80ab815a30d5014f4))
* bump intentd sidecar to v0.9.15 ([#2138](https://github.com/intent-hq/cloudlands-fe/issues/2138)) ([da69118](https://github.com/intent-hq/cloudlands-fe/commit/da69118e2f8ff6e8f469fbd0989bd44d5f4bd5d7))
* constrain and dismiss panel actions menu ([#2121](https://github.com/intent-hq/cloudlands-fe/issues/2121)) ([0b0f5ef](https://github.com/intent-hq/cloudlands-fe/commit/0b0f5ef9788fe14d0410506f2df33a8c1d66baf0))
* **settings:** feed Listen targets from pairingInfo.availableIps ([#2129](https://github.com/intent-hq/cloudlands-fe/issues/2129)) ([a87e2e6](https://github.com/intent-hq/cloudlands-fe/commit/a87e2e68acb101b7e5c18941cf41740b001da6c1))
* **sidebar:** remove section counts ([#2122](https://github.com/intent-hq/cloudlands-fe/issues/2122)) ([2f123a1](https://github.com/intent-hq/cloudlands-fe/commit/2f123a1299e357f75f51697d9626e1c629856b0b))

## [2.130.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.130.0...v2.130.1) (2026-09-03)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.13 ([#2123](https://github.com/intent-hq/cloudlands-fe/issues/2123)) ([110c1b9](https://github.com/intent-hq/cloudlands-fe/commit/110c1b9e9b85ce01f37f7da277b68d5ba46ab6c3))

## [2.130.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.129.1...v2.130.0) (2026-09-03)


### 🚀 Features

* **settings:** always bind loopback and allow hand-picking listen targets ([#2115](https://github.com/intent-hq/cloudlands-fe/issues/2115)) ([fb52741](https://github.com/intent-hq/cloudlands-fe/commit/fb527412e29422e482f564c9f60f0930d77f59ba))
* **settings:** split idle reap into switch row and conditional minutes row ([#2114](https://github.com/intent-hq/cloudlands-fe/issues/2114)) ([c5f3d3e](https://github.com/intent-hq/cloudlands-fe/commit/c5f3d3e64dc3aa5fc708691acdc480c81aa92e90))

## [2.129.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.129.0...v2.129.1) (2026-09-03)


### 🐛 Bug Fixes

* refresh remote detected addresses from system.status localIps ([#2105](https://github.com/intent-hq/cloudlands-fe/issues/2105)) ([b862467](https://github.com/intent-hq/cloudlands-fe/commit/b862467706070be56cbd2526593bfd7cca0925bd))

## [2.129.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.128.0...v2.129.0) (2026-09-03)


### 🚀 Features

* image and video parity in chats and notes ([#2086](https://github.com/intent-hq/cloudlands-fe/issues/2086)) ([ca6ef43](https://github.com/intent-hq/cloudlands-fe/commit/ca6ef4381a81a30357082b62bcfa826c2a4d3ace))

## [2.128.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.127.0...v2.128.0) (2026-09-03)


### 🚀 Features

* add settings toggles for chat aurora and translucent window ([#2076](https://github.com/intent-hq/cloudlands-fe/issues/2076)) ([652b4a3](https://github.com/intent-hq/cloudlands-fe/commit/652b4a3f6e787c0de3b989343ba8e7999291f011))
* **daemon-status:** show via-tailcat indicator when the tunnel wins the connect race ([#2099](https://github.com/intent-hq/cloudlands-fe/issues/2099)) ([9bfcb98](https://github.com/intent-hq/cloudlands-fe/commit/9bfcb980802d6ba76d3ff746fa650c293057ee36))
* **devices:** read-only network details, detect-IPs and push-to-cloud toggles in device edit ([#2095](https://github.com/intent-hq/cloudlands-fe/issues/2095)) ([a4953eb](https://github.com/intent-hq/cloudlands-fe/commit/a4953eb87cf957bb121309d890707c10b77596ab))
* **external-editors:** add configurable editor ordering ([#2064](https://github.com/intent-hq/cloudlands-fe/issues/2064)) ([e68919c](https://github.com/intent-hq/cloudlands-fe/commit/e68919ca7aaf64260ef58eaa0ecfcbb41dcf84a5))
* **providers:** show provider identity (email/org) on the provider card ([#2093](https://github.com/intent-hq/cloudlands-fe/issues/2093)) ([9d2fac4](https://github.com/intent-hq/cloudlands-fe/commit/9d2fac48228bc3d56a36e5b9d04b7da4361b9304))
* render workspace videos from markdown ([#2062](https://github.com/intent-hq/cloudlands-fe/issues/2062)) ([049966f](https://github.com/intent-hq/cloudlands-fe/commit/049966f56da63ff2285c11284acc6d10c1084bf4))
* reorder WebSocket API settings and add Local Network Access toggle ([#2087](https://github.com/intent-hq/cloudlands-fe/issues/2087)) ([b9ca5dc](https://github.com/intent-hq/cloudlands-fe/commit/b9ca5dc9578bf87276101a47fb1c472ff66af1bd))
* revamp embedded browser panel with fit-panel viewport and element picker ([#2073](https://github.com/intent-hq/cloudlands-fe/issues/2073)) ([144cd26](https://github.com/intent-hq/cloudlands-fe/commit/144cd26a8195e2c7b422d79c46cd1d29e597218c))
* **sidebar:** show one PR icon per workspace row, earliest flow state first ([#2081](https://github.com/intent-hq/cloudlands-fe/issues/2081)) ([5c279f2](https://github.com/intent-hq/cloudlands-fe/commit/5c279f21072343c78f0fa0ac48ee955f0aee2329))
* **specialists:** pick model-option effort inside the ModelPicker dropdown ([#2080](https://github.com/intent-hq/cloudlands-fe/issues/2080)) ([6183862](https://github.com/intent-hq/cloudlands-fe/commit/618386243b35834d761b1433ace993cd80f6ac72))
* **workspace:** render the pr_queued display status ([#2096](https://github.com/intent-hq/cloudlands-fe/issues/2096)) ([35eb0de](https://github.com/intent-hq/cloudlands-fe/commit/35eb0de680d895ab2b235bdaba81139fe0d35056))
* **workspace:** restyle hover card and share hover intent across rows and tabs ([#2069](https://github.com/intent-hq/cloudlands-fe/issues/2069)) ([113ebd9](https://github.com/intent-hq/cloudlands-fe/commit/113ebd95fccc8c143ed9d0dca592f73351ec84f7))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.10 ([#2092](https://github.com/intent-hq/cloudlands-fe/issues/2092)) ([97fa9ba](https://github.com/intent-hq/cloudlands-fe/commit/97fa9ba8c67fdc265d14560ec93d95b9bdabd883))
* bump intentd sidecar to v0.9.11 ([#2097](https://github.com/intent-hq/cloudlands-fe/issues/2097)) ([c86b357](https://github.com/intent-hq/cloudlands-fe/commit/c86b357d2e34667ad555fb204c9094054c1dbedd))
* bump intentd sidecar to v0.9.12 ([#2100](https://github.com/intent-hq/cloudlands-fe/issues/2100)) ([dbdea8c](https://github.com/intent-hq/cloudlands-fe/commit/dbdea8caaf33b8db1e8cf3e25d69481538db7b0a))
* dedupe workspace-open window requests ([#2047](https://github.com/intent-hq/cloudlands-fe/issues/2047)) ([69aada0](https://github.com/intent-hq/cloudlands-fe/commit/69aada020d645e9ed8a85f63fa8452bda85d0209))
* make Chief + create new threads and polish Chief header ([#2079](https://github.com/intent-hq/cloudlands-fe/issues/2079)) ([682012a](https://github.com/intent-hq/cloudlands-fe/commit/682012a3e24df247dd28f2e40fdbd77dfe3063e9))
* make tray-hosted proposal cards full-width and flat ([#2083](https://github.com/intent-hq/cloudlands-fe/issues/2083)) ([8ebee74](https://github.com/intent-hq/cloudlands-fe/commit/8ebee7491e66e5deb904684f9c62d513e2ef5bde))
* normalize short-form reference blocks in notes ([#2055](https://github.com/intent-hq/cloudlands-fe/issues/2055)) ([2c05815](https://github.com/intent-hq/cloudlands-fe/commit/2c05815a9ce8c16a48dafd8cfc545ef0b42f017c))
* **notes:** size code blocks at 13px to match chat ([#2051](https://github.com/intent-hq/cloudlands-fe/issues/2051)) ([7581fdb](https://github.com/intent-hq/cloudlands-fe/commit/7581fdb137bae4813915098b61d0f90dd158988a))
* **onboarding:** support non-git local folders and explain a disabled Create button ([#2058](https://github.com/intent-hq/cloudlands-fe/issues/2058)) ([d5d3ad2](https://github.com/intent-hq/cloudlands-fe/commit/d5d3ad24bb849baa216f7a0752eaef8bbab8fa4b))
* restore streaming response group cylinder ([#2057](https://github.com/intent-hq/cloudlands-fe/issues/2057)) ([f0df787](https://github.com/intent-hq/cloudlands-fe/commit/f0df787ffa8f5990108ab81b0a8885960920c712))
* **settings:** consume the ModelPicker pick triple on the main Model row ([#2085](https://github.com/intent-hq/cloudlands-fe/issues/2085)) ([e4f9616](https://github.com/intent-hq/cloudlands-fe/commit/e4f961606e401419f3106d4bea46647e9da624e1))
* **settings:** resolve main Model row effort levels against the picked provider ([#2091](https://github.com/intent-hq/cloudlands-fe/issues/2091)) ([83d01c9](https://github.com/intent-hq/cloudlands-fe/commit/83d01c9b71dfc65a52b7ca5c4e2e5ae4fc88b401))
* shard verify-changed locks by check kind ([#2077](https://github.com/intent-hq/cloudlands-fe/issues/2077)) ([5d4ff27](https://github.com/intent-hq/cloudlands-fe/commit/5d4ff27ca1856cc013f5f798f571c2bdfb4eac0b))


### ⚡ Performance

* reduce Aurora GPU work ([#2045](https://github.com/intent-hq/cloudlands-fe/issues/2045)) ([b639051](https://github.com/intent-hq/cloudlands-fe/commit/b639051be0e7175d251948f6508f372aed71253e))

## [2.127.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.126.2...v2.127.0) (2026-09-03)


### 🚀 Features

* model selection, agent creation, and settings surfaces use the model triple ([#2066](https://github.com/intent-hq/cloudlands-fe/issues/2066)) ([cbfb4e2](https://github.com/intent-hq/cloudlands-fe/commit/cbfb4e23e1f2376284d371c0e286684bc6e84260))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.9 ([#2075](https://github.com/intent-hq/cloudlands-fe/issues/2075)) ([413c76a](https://github.com/intent-hq/cloudlands-fe/commit/413c76a60c1fb8e39adecc5d9ebc381423c48a72))

## [2.126.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.126.1...v2.126.2) (2026-09-03)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.8 ([#2070](https://github.com/intent-hq/cloudlands-fe/issues/2070)) ([e028d7f](https://github.com/intent-hq/cloudlands-fe/commit/e028d7f9455a57e1de41b5f49acbf40df3ad196e))

## [2.126.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.126.0...v2.126.1) (2026-09-02)


### 🐛 Bug Fixes

* **titlebar:** Preserve Mac sidebar clearance when zooming ([#2060](https://github.com/intent-hq/cloudlands-fe/issues/2060)) ([fc832bc](https://github.com/intent-hq/cloudlands-fe/commit/fc832bcee63af6b56502028c11b6ab81e766cdeb))

## [2.126.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.125.0...v2.126.0) (2026-09-02)


### 🚀 Features

* connect to server via intent://pair deep links ([#2043](https://github.com/intent-hq/cloudlands-fe/issues/2043)) ([3e78979](https://github.com/intent-hq/cloudlands-fe/commit/3e789794d3d22c65dc247598e5739b1b7b2cda65))
* devices and advanced settings UI for the tailcat tunnel ([#2030](https://github.com/intent-hq/cloudlands-fe/issues/2030)) ([b62657d](https://github.com/intent-hq/cloudlands-fe/commit/b62657d6dee5ae14e091df4950926fbf1b9829f5))
* dial remote backends through a bundled tailcat tunnel client ([#2013](https://github.com/intent-hq/cloudlands-fe/issues/2013)) ([f9aa9be](https://github.com/intent-hq/cloudlands-fe/commit/f9aa9bef87d005474c1a119353ae936eeefe26e8))
* retire compound-model-id helpers for the model triple ([#2041](https://github.com/intent-hq/cloudlands-fe/issues/2041)) ([4c793d0](https://github.com/intent-hq/cloudlands-fe/commit/4c793d0458d0c1dc7ac34dde0b0c5b7bb4ce12b3))
* **settings:** reorganize WebSocket API settings with a top-level tunnel toggle ([#2042](https://github.com/intent-hq/cloudlands-fe/issues/2042)) ([1819c26](https://github.com/intent-hq/cloudlands-fe/commit/1819c26e09df74f6a83c6232b3d6e9c9a21bac68))
* sync tc address across devices via keychain and refresh flows ([#2024](https://github.com/intent-hq/cloudlands-fe/issues/2024)) ([4c90307](https://github.com/intent-hq/cloudlands-fe/commit/4c90307b2c692f22819301a42454c8e7fb6587fc))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.6 ([#2048](https://github.com/intent-hq/cloudlands-fe/issues/2048)) ([28316b1](https://github.com/intent-hq/cloudlands-fe/commit/28316b1b783158d0011ede9a3655dca12837af15))
* bump intentd sidecar to v0.9.7 ([#2053](https://github.com/intent-hq/cloudlands-fe/issues/2053)) ([24ecbe7](https://github.com/intent-hq/cloudlands-fe/commit/24ecbe78c777de5406d6eb0155e9272761765c0c))
* filter loopback addresses from the keychain registry and keep the self entry fresh ([#2044](https://github.com/intent-hq/cloudlands-fe/issues/2044)) ([0b9e2ce](https://github.com/intent-hq/cloudlands-fe/commit/0b9e2ced33b7f4845b484f5353b5cb24e3e66343))

## [2.125.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.124.1...v2.125.0) (2026-09-02)


### 🚀 Features

* allow dragging folders into chat as path references (local daemon) ([#2035](https://github.com/intent-hq/cloudlands-fe/issues/2035)) ([9752e36](https://github.com/intent-hq/cloudlands-fe/commit/9752e365a00158d86851ca7c940be6c0a09fed81))
* **chat:** login guidance on agent auth-failure surfaces ([#2031](https://github.com/intent-hq/cloudlands-fe/issues/2031)) ([14bef3a](https://github.com/intent-hq/cloudlands-fe/commit/14bef3a1a5d47152bae00f119e4dd8c1a9e89069))
* **ci:** allow manual builds to compile intentd from a ref ([#2023](https://github.com/intent-hq/cloudlands-fe/issues/2023)) ([a3c6c2d](https://github.com/intent-hq/cloudlands-fe/commit/a3c6c2d33ce7b4e7fab5c950297209caad10160c))
* gate field-derived attention indicators on live agent activity ([#2027](https://github.com/intent-hq/cloudlands-fe/issues/2027)) ([9484b78](https://github.com/intent-hq/cloudlands-fe/commit/9484b785643ed338def583092d3f691b1304b0dc))
* order subagent rows non-idle-first by recency, idle last ([#2026](https://github.com/intent-hq/cloudlands-fe/issues/2026)) ([54fb8fd](https://github.com/intent-hq/cloudlands-fe/commit/54fb8fdc5762b41626ba0e67cdf74f3a2444b747))
* polish workspace navigation and chat presentation ([#2008](https://github.com/intent-hq/cloudlands-fe/issues/2008)) ([237b3c0](https://github.com/intent-hq/cloudlands-fe/commit/237b3c0ce87562ab217dfcb127a4fedc0457927e))
* refine workspace panel and tab interactions ([#1965](https://github.com/intent-hq/cloudlands-fe/issues/1965)) ([0519bd8](https://github.com/intent-hq/cloudlands-fe/commit/0519bd8103f1cafeafa159c2bd042eba97769c7e))
* select highlighted folder in directory picker ([#2032](https://github.com/intent-hq/cloudlands-fe/issues/2032)) ([21a4eca](https://github.com/intent-hq/cloudlands-fe/commit/21a4ecaa8242191bd1543997afb9da4772ce0066))
* support dropping folders into the new-workspace modal as path references ([#2036](https://github.com/intent-hq/cloudlands-fe/issues/2036)) ([df7568d](https://github.com/intent-hq/cloudlands-fe/commit/df7568d6b323b26da113c4d48f4b65f58e215db2))
* suppress agent-attention toast when the user is already viewing the agent ([#2021](https://github.com/intent-hq/cloudlands-fe/issues/2021)) ([b6c12d7](https://github.com/intent-hq/cloudlands-fe/commit/b6c12d778527f019aadd824ebb0017f4ebc246f5))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.9.4 ([#2025](https://github.com/intent-hq/cloudlands-fe/issues/2025)) ([753aefe](https://github.com/intent-hq/cloudlands-fe/commit/753aefee160d1b8e2c26931a158dda32425bf1cc))
* bump intentd sidecar to v0.9.5 ([#2039](https://github.com/intent-hq/cloudlands-fe/issues/2039)) ([d63aabb](https://github.com/intent-hq/cloudlands-fe/commit/d63aabb2a2b6bf268feb22c2f138fdece0e60b62))
* **chat:** order transcript by daemon seq so idle-send skew cannot invert rows ([#2037](https://github.com/intent-hq/cloudlands-fe/issues/2037)) ([c8bd706](https://github.com/intent-hq/cloudlands-fe/commit/c8bd706b24da373e8199f5e7ee9c4a7b0f8635fc))
* clear crash-leftover isStreaming/isProcessing on agent list refresh ([#2028](https://github.com/intent-hq/cloudlands-fe/issues/2028)) ([8d3119c](https://github.com/intent-hq/cloudlands-fe/commit/8d3119ce1574172d476c8732acfc264c8e8850db))
* dedup re-dropped folder on onboarding prompt step ([#2038](https://github.com/intent-hq/cloudlands-fe/issues/2038)) ([4a9abdc](https://github.com/intent-hq/cloudlands-fe/commit/4a9abdcfd284a1ba12725c6ebde5efea1f1a1f58))
* make Markdown preview read-only ([#2017](https://github.com/intent-hq/cloudlands-fe/issues/2017)) ([f64d0cc](https://github.com/intent-hq/cloudlands-fe/commit/f64d0cccd120d0be26dc920d1a7dea5b3c83c74d))
* mount hidden agent-owned tabs on demand for capture ops ([#2029](https://github.com/intent-hq/cloudlands-fe/issues/2029)) ([28aa965](https://github.com/intent-hq/cloudlands-fe/commit/28aa965693fd5dca167d36d09311ebe22e0224a6))
* persist the Undo changes revert in AgentRulesEditor ([#2018](https://github.com/intent-hq/cloudlands-fe/issues/2018)) ([4183aaa](https://github.com/intent-hq/cloudlands-fe/commit/4183aaa71a4217ba5b98846a29c36f153f2ec32b))
* preserve nested reasoning section boundaries ([#1869](https://github.com/intent-hq/cloudlands-fe/issues/1869)) ([b98bc05](https://github.com/intent-hq/cloudlands-fe/commit/b98bc055337d09f2d785e88d9c866dcc637cbc1f))
* reconcile cross-provider default model settings ([#2009](https://github.com/intent-hq/cloudlands-fe/issues/2009)) ([406be63](https://github.com/intent-hq/cloudlands-fe/commit/406be63bd1f3c63ea61373a7d6dc51c1f7785626))
* remove Escape stream-stop shortcut ([#2015](https://github.com/intent-hq/cloudlands-fe/issues/2015)) ([59bcf44](https://github.com/intent-hq/cloudlands-fe/commit/59bcf44152a7f532881c42401bc9279b4b923688))
* restore window sessions to the correct monitor and preserve fullscreen ([#2034](https://github.com/intent-hq/cloudlands-fe/issues/2034)) ([5bfef14](https://github.com/intent-hq/cloudlands-fe/commit/5bfef146981155c77ca1fd7901640ebc2c2852ec))
* **titlebar:** Prevent workspace tab vertical scrolling ([#2016](https://github.com/intent-hq/cloudlands-fe/issues/2016)) ([0d9612d](https://github.com/intent-hq/cloudlands-fe/commit/0d9612d7f2fdd330ab88f6e0953d4dde99312dba))
* tolerate svelte-check COMPLETED variants and drain output before evaluating the check guard ([#2020](https://github.com/intent-hq/cloudlands-fe/issues/2020)) ([aad72ec](https://github.com/intent-hq/cloudlands-fe/commit/aad72ec0426b84a201b3e40575e5739f5bbcfc5b))
* unify tool result transcript visibility ([#1833](https://github.com/intent-hq/cloudlands-fe/issues/1833)) ([90687e0](https://github.com/intent-hq/cloudlands-fe/commit/90687e02998a59217624eb811549c5282cd8dc1d))


### ⚡ Performance

* Bound renderer update churn ([#2014](https://github.com/intent-hq/cloudlands-fe/issues/2014)) ([cdc386a](https://github.com/intent-hq/cloudlands-fe/commit/cdc386a760ea63cb2fe8a00a816579eca40f646d))

## [2.124.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.124.0...v2.124.1) (2026-09-01)


### 🐛 Bug Fixes

* resolve workspace protocol backends by ownership probing ([#2007](https://github.com/intent-hq/cloudlands-fe/issues/2007)) ([e5296e6](https://github.com/intent-hq/cloudlands-fe/commit/e5296e67e784e2d09a54933c617d82563cc19f72))

## [2.124.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.123.1...v2.124.0) (2026-09-01)


### 🚀 Features

* open chat navigator at newest message with index loading indicator ([#2004](https://github.com/intent-hq/cloudlands-fe/issues/2004)) ([f257aef](https://github.com/intent-hq/cloudlands-fe/commit/f257aef11a3c71c045b2c61ebe0591b1e03e58d2))
* restore legacy workspace import (revert [#1980](https://github.com/intent-hq/cloudlands-fe/issues/1980)) ([#1998](https://github.com/intent-hq/cloudlands-fe/issues/1998)) ([778b3f7](https://github.com/intent-hq/cloudlands-fe/commit/778b3f7b3277a50dbd7d7398151ceeafb9c9dab7))
* use shared Checkbox for the detect-all-backend-IPs option in ConnectBackendModal ([#2002](https://github.com/intent-hq/cloudlands-fe/issues/2002)) ([cbabd2b](https://github.com/intent-hq/cloudlands-fe/commit/cbabd2b9c13260b8dacca7c3cfbb9e93a0a2673e))


### 🐛 Bug Fixes

* avoid forced reflow loop in SimpleRichInput panel-height effect ([#1999](https://github.com/intent-hq/cloudlands-fe/issues/1999)) ([17600d6](https://github.com/intent-hq/cloudlands-fe/commit/17600d63b10813012dba09f72590bc7e852a2061))
* bump intentd sidecar to v0.9.2 ([#2006](https://github.com/intent-hq/cloudlands-fe/issues/2006)) ([788fdc9](https://github.com/intent-hq/cloudlands-fe/commit/788fdc9980af583d98819624b16598c936b5a15f))
* bump intentd sidecar to v0.9.3 ([#2010](https://github.com/intent-hq/cloudlands-fe/issues/2010)) ([03e18d5](https://github.com/intent-hq/cloudlands-fe/commit/03e18d5249a6ba0cb961233e588f351f5f75b06a))
* keep the terminal response group expanded on turn demotion ([#2003](https://github.com/intent-hq/cloudlands-fe/issues/2003)) ([3ef8373](https://github.com/intent-hq/cloudlands-fe/commit/3ef83731845086cdca1b04f8980fea0f1c49740d))
* let token usage tooltip size to its content ([#1994](https://github.com/intent-hq/cloudlands-fe/issues/1994)) ([4e912f7](https://github.com/intent-hq/cloudlands-fe/commit/4e912f7fcae0cffad1d86779e11df685a8a68aae))
* pin the /tunnel socket at the TLS handshake (createTunnelSocket) ([#1997](https://github.com/intent-hq/cloudlands-fe/issues/1997)) ([f5517ab](https://github.com/intent-hq/cloudlands-fe/commit/f5517ab9658340d50a7b6a054d8acfe732663f90))
* pin the wss transport at the TLS handshake (createWssSocket) ([#1995](https://github.com/intent-hq/cloudlands-fe/issues/1995)) ([3b08a4b](https://github.com/intent-hq/cloudlands-fe/commit/3b08a4bf7ceb676034011f2b1c189c12e2be2cc6))
* preserve leading/trailing newlines in Global Instructions auto-save ([#2005](https://github.com/intent-hq/cloudlands-fe/issues/2005)) ([705455d](https://github.com/intent-hq/cloudlands-fe/commit/705455dc34fbc609eb777521bd8946a64deb2ace))
* read hasUnpushed from git.status hasUpstream/unpushedCount ([#1996](https://github.com/intent-hq/cloudlands-fe/issues/1996)) ([2df8088](https://github.com/intent-hq/cloudlands-fe/commit/2df8088d756d90bb98f65b58fa23f3efe8f09ac2))

## [2.123.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.123.0...v2.123.1) (2026-09-01)


### 🐛 Bug Fixes

* bridge workspace summary IPC channels to the daemon ([#1985](https://github.com/intent-hq/cloudlands-fe/issues/1985)) ([fefe5ef](https://github.com/intent-hq/cloudlands-fe/commit/fefe5ef9441054225187277ed1a116d1335ac5f1))
* bump intentd sidecar to v0.9.1 ([#1993](https://github.com/intent-hq/cloudlands-fe/issues/1993)) ([ef3d46a](https://github.com/intent-hq/cloudlands-fe/commit/ef3d46aa498e270bb38791b701c37746f626de99))
* keep panel resize handles off neighboring scrollbars ([#1988](https://github.com/intent-hq/cloudlands-fe/issues/1988)) ([8d159d9](https://github.com/intent-hq/cloudlands-fe/commit/8d159d9dbaf34bd43e967645e1997ddff4e2c67d))
* migrate onboarding images to context items and stop dropping first-message attachments ([#1986](https://github.com/intent-hq/cloudlands-fe/issues/1986)) ([76d9b43](https://github.com/intent-hq/cloudlands-fe/commit/76d9b43d38e130fccea4bc62440a3c536e1dd4c0))
* probe fingerprint unauthenticated before transmitting saved token ([#1987](https://github.com/intent-hq/cloudlands-fe/issues/1987)) ([491c59f](https://github.com/intent-hq/cloudlands-fe/commit/491c59f1d4a8f603019aa3bcd42fd1dbd5f1cc1f))
* stop hydration frontier mass-hydrating transcript on workspace switch ([#1991](https://github.com/intent-hq/cloudlands-fe/issues/1991)) ([54245d7](https://github.com/intent-hq/cloudlands-fe/commit/54245d7d49a48e47d657f0243226f7a702f4ce16))

## [2.123.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.122.1...v2.123.0) (2026-09-01)


### 🚀 Features

* continue wss race past pin mismatches and collect per-host cert failures ([#1975](https://github.com/intent-hq/cloudlands-fe/issues/1975)) ([249fefc](https://github.com/intent-hq/cloudlands-fe/commit/249fefc457c9809a50e814b4584318f1afb889bb))
* pipe non-fatal per-host cert warnings to the renderer ([#1981](https://github.com/intent-hq/cloudlands-fe/issues/1981)) ([1fb6445](https://github.com/intent-hq/cloudlands-fe/commit/1fb6445831d5d72b8b100867406e3a3d432faf8a))
* show passive per-host cert failure list while reconnecting ([#1983](https://github.com/intent-hq/cloudlands-fe/issues/1983)) ([3ae67c2](https://github.com/intent-hq/cloudlands-fe/commit/3ae67c27be0cb4a4a18f0121ae2ba0babd58dc2d))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.32 ([#1982](https://github.com/intent-hq/cloudlands-fe/issues/1982)) ([69a6db6](https://github.com/intent-hq/cloudlands-fe/commit/69a6db640d53a5e320e257669b6c1e0c0356ff69))
* bump intentd sidecar to v0.9.0 ([#1984](https://github.com/intent-hq/cloudlands-fe/issues/1984)) ([fef86ee](https://github.com/intent-hq/cloudlands-fe/commit/fef86eeca7f3e8dad495606ad1dbb911f0e3b168))
* increase Windows icon footprint ([#1962](https://github.com/intent-hq/cloudlands-fe/issues/1962)) ([a5b8545](https://github.com/intent-hq/cloudlands-fe/commit/a5b85452ecf9d08f2a82ee668a6179ae8fba1606))
* open the window on connect even when the backend is unreachable ([#1974](https://github.com/intent-hq/cloudlands-fe/issues/1974)) ([4acb1b3](https://github.com/intent-hq/cloudlands-fe/commit/4acb1b3bde67b93af781d325fa6b57d9f05ffd46))
* persist active UI layout preferences ([#1971](https://github.com/intent-hq/cloudlands-fe/issues/1971)) ([c1d7a54](https://github.com/intent-hq/cloudlands-fe/commit/c1d7a54dab490c052526c50cf8a2a4066a04c1cc))
* **settings:** show full TLS fingerprint in WebSocket API settings ([#1979](https://github.com/intent-hq/cloudlands-fe/issues/1979)) ([735725c](https://github.com/intent-hq/cloudlands-fe/commit/735725c15636087c2687032744843a0ade24eab3))
* **workspace:** Separate Context and Spec launcher actions ([#1964](https://github.com/intent-hq/cloudlands-fe/issues/1964)) ([647842d](https://github.com/intent-hq/cloudlands-fe/commit/647842dca46048e9838e2168d45345da07e79ffe))


### ⚡ Performance

* **ui:** Minimize style recalculation and layout work ([#1968](https://github.com/intent-hq/cloudlands-fe/issues/1968)) ([7f02457](https://github.com/intent-hq/cloudlands-fe/commit/7f02457374ee78c8e46e8f81795e9934a3a79bc0))

## [2.122.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.122.0...v2.122.1) (2026-09-01)


### 🐛 Bug Fixes

* prevent effect_update_depth_exceeded on dedicated-agent route ([#1970](https://github.com/intent-hq/cloudlands-fe/issues/1970)) ([97e7f6a](https://github.com/intent-hq/cloudlands-fe/commit/97e7f6a6daf66a0dce22843c99c414dc22dc00a7))

## [2.122.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.121.0...v2.122.0) (2026-08-31)


### 🚀 Features

* refine project sidebar workspace actions ([#1966](https://github.com/intent-hq/cloudlands-fe/issues/1966)) ([5191ced](https://github.com/intent-hq/cloudlands-fe/commit/5191ced77ae1e1e76bdc84271f352bd4d0fece5b))

## [2.121.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.120.0...v2.121.0) (2026-08-31)


### 🚀 Features

* surface agent file locks in the Changes panel ([#1959](https://github.com/intent-hq/cloudlands-fe/issues/1959)) ([a9f9dd7](https://github.com/intent-hq/cloudlands-fe/commit/a9f9dd73424c6bafa54353068e94a36e90426986))

## [2.120.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.119.0...v2.120.0) (2026-08-31)


### 🚀 Features

* make keyboard shortcuts editable ([#1922](https://github.com/intent-hq/cloudlands-fe/issues/1922)) ([1fdc246](https://github.com/intent-hq/cloudlands-fe/commit/1fdc246437038ab94f656cc75b12a505e740a18a))

## [2.119.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.118.0...v2.119.0) (2026-08-31)


### 🚀 Features

* consume daemon-published agent lock state (protocol v8.8) ([#1952](https://github.com/intent-hq/cloudlands-fe/issues/1952)) ([10351c6](https://github.com/intent-hq/cloudlands-fe/commit/10351c6c6b3dcad23912d35c346f9e8d3b0048c4))
* seed context-link split layout on first open of workspaces created elsewhere ([#1933](https://github.com/intent-hq/cloudlands-fe/issues/1933)) ([c50b718](https://github.com/intent-hq/cloudlands-fe/commit/c50b7189f032a26ea386daffd661756fadb3d585))
* seed split layout with context-link browser tabs on workspace create ([#1930](https://github.com/intent-hq/cloudlands-fe/issues/1930)) ([422d7a5](https://github.com/intent-hq/cloudlands-fe/commit/422d7a51e386ef2430af3eb3f15a62fe23ba0b8f))
* send contextLinks and PR head/base branch params on workspace.create ([#1927](https://github.com/intent-hq/cloudlands-fe/issues/1927)) ([c7e5c3e](https://github.com/intent-hq/cloudlands-fe/commit/c7e5c3e2975e8ae9847ee8624c176a59776cecae))
* wire sidebar MCP toggle to daemon per-workspace disable ([#1953](https://github.com/intent-hq/cloudlands-fe/issues/1953)) ([39f9c90](https://github.com/intent-hq/cloudlands-fe/commit/39f9c90e3d79ec6f6d8f37de45270faa9d32ce41))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.30 ([#1958](https://github.com/intent-hq/cloudlands-fe/issues/1958)) ([33f11a1](https://github.com/intent-hq/cloudlands-fe/commit/33f11a114ea25690cc670ad68cf978e0c92cb383))
* bump intentd sidecar to v0.8.31 ([#1960](https://github.com/intent-hq/cloudlands-fe/issues/1960)) ([39db39a](https://github.com/intent-hq/cloudlands-fe/commit/39db39a8375b2b901931c32443a298916752d6e4))
* keep New Workspace modal within viewport when issues panel expands ([#1957](https://github.com/intent-hq/cloudlands-fe/issues/1957)) ([2574352](https://github.com/intent-hq/cloudlands-fe/commit/2574352e27597e6239cfa46d8954f113638a3ff2))
* rebuild unread-notes computation saga ([#1945](https://github.com/intent-hq/cloudlands-fe/issues/1945)) ([7562c2e](https://github.com/intent-hq/cloudlands-fe/commit/7562c2e296e2da78e60790998c8e8db02a4ed915))
* remove orphaned Changes-tab actions and dead components ([#1940](https://github.com/intent-hq/cloudlands-fe/issues/1940)) ([ecbdf85](https://github.com/intent-hq/cloudlands-fe/commit/ecbdf85f748658fc30557319b4143485c9104fad))
* restore per-workspace sidebar persistence and remove superseded nav actions ([#1942](https://github.com/intent-hq/cloudlands-fe/issues/1942)) ([ec45cd0](https://github.com/intent-hq/cloudlands-fe/commit/ec45cd0c4faf2833a0f64f0facad59036aae6fa0))
* restore proposal apply/undo lifecycle sagas and history (silent no-op since saga-infra removal) ([#1947](https://github.com/intent-hq/cloudlands-fe/issues/1947)) ([4f8ae91](https://github.com/intent-hq/cloudlands-fe/commit/4f8ae91389e09d10a6704cb87280d43cc83657a8))
* rewire terminal-tab and model-refresh dispatches off deleted saga listeners ([#1937](https://github.com/intent-hq/cloudlands-fe/issues/1937)) ([e7a11f7](https://github.com/intent-hq/cloudlands-fe/commit/e7a11f745c36bf4670b67602b139094c552786fb))
* **store:** remove orphaned saga-trigger actions and wire direct calls ([#1949](https://github.com/intent-hq/cloudlands-fe/issues/1949)) ([c52c81c](https://github.com/intent-hq/cloudlands-fe/commit/c52c81c560e99ba15657072da0bb51bab1087c42))
* **store:** wire delegateExistingTaskRequested to daemon agent.delegate ([#1951](https://github.com/intent-hq/cloudlands-fe/issues/1951)) ([b55a64e](https://github.com/intent-hq/cloudlands-fe/commit/b55a64ed9d771656fcf5317ddf7283b8f8485270))

## [2.118.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.117.3...v2.118.0) (2026-08-31)


### 🚀 Features

* **chat:** keep terminal response group of the final assistant message expanded when not streaming ([#1946](https://github.com/intent-hq/cloudlands-fe/issues/1946)) ([ac81b8e](https://github.com/intent-hq/cloudlands-fe/commit/ac81b8e3277b91369959a536472f1c33048c7626))

## [2.117.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.117.2...v2.117.3) (2026-08-31)


### 🐛 Bug Fixes

* **chat:** honor persisted older-scrollback token when history segment is empty ([#1939](https://github.com/intent-hq/cloudlands-fe/issues/1939)) ([83ad1bd](https://github.com/intent-hq/cloudlands-fe/commit/83ad1bdcefc8e0692f1bd7c9549d83adace559b0))
* subscribe notification service to agent:idle on every backend ([#1943](https://github.com/intent-hq/cloudlands-fe/issues/1943)) ([2f2d3c1](https://github.com/intent-hq/cloudlands-fe/commit/2f2d3c1752fb709f940ce712d4f64aa1891c22a0))

## [2.117.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.117.1...v2.117.2) (2026-08-31)


### ⚡ Performance

* reduce hover card and tooltip positioning cost ([#1936](https://github.com/intent-hq/cloudlands-fe/issues/1936)) ([48b7a21](https://github.com/intent-hq/cloudlands-fe/commit/48b7a21b77d46ab8a36be855660aff1fc4983b01))

## [2.117.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.117.0...v2.117.1) (2026-08-31)


### 🐛 Bug Fixes

* keep cross-repo context on workspace card PR rows ([#1934](https://github.com/intent-hq/cloudlands-fe/issues/1934)) ([4094e98](https://github.com/intent-hq/cloudlands-fe/commit/4094e98a605cbe35549f4d58ab15b352477ddf1e))

## [2.117.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.116.2...v2.117.0) (2026-08-31)


### 🚀 Features

* actionable login guidance + explicit Recheck on the log-in surfaces ([#1919](https://github.com/intent-hq/cloudlands-fe/issues/1919)) ([39c444b](https://github.com/intent-hq/cloudlands-fe/commit/39c444ba86cc2a1f6e576bf35138489b4b86b0af))
* sticky behind-pin update toast and undo-toast countdown bar ([#1914](https://github.com/intent-hq/cloudlands-fe/issues/1914)) ([da3c005](https://github.com/intent-hq/cloudlands-fe/commit/da3c0052423fa2a9f7c7e78559aa8cf412a67b48))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.28 ([#1923](https://github.com/intent-hq/cloudlands-fe/issues/1923)) ([5a07555](https://github.com/intent-hq/cloudlands-fe/commit/5a07555a1faafcb59821400e191359c325462eab))
* bump intentd sidecar to v0.8.29 ([#1931](https://github.com/intent-hq/cloudlands-fe/issues/1931)) ([d0c4069](https://github.com/intent-hq/cloudlands-fe/commit/d0c406903b505e8dc66d32318101988b67cc1df1))
* hide uncommitted-changes indicator when skip-isolation is active ([#1920](https://github.com/intent-hq/cloudlands-fe/issues/1920)) ([fc0079a](https://github.com/intent-hq/cloudlands-fe/commit/fc0079ab25d7fb1c5178d4fce87b134dd1deca0b))
* prevent slash-skill popup from opening on pasted content ([#1917](https://github.com/intent-hq/cloudlands-fe/issues/1917)) ([95e3d74](https://github.com/intent-hq/cloudlands-fe/commit/95e3d742dbc549bc2dcb715557d28af9f5c68cf2))
* prevent state_unsafe_mutation when editor blurs during tab or workspace switch ([#1921](https://github.com/intent-hq/cloudlands-fe/issues/1921)) ([033a9cd](https://github.com/intent-hq/cloudlands-fe/commit/033a9cd77a56588cdf86f3b41261ff2cb7287705))
* recapture local updateSupported after startup mode resolution ([#1916](https://github.com/intent-hq/cloudlands-fe/issues/1916)) ([3cfb3a6](https://github.com/intent-hq/cloudlands-fe/commit/3cfb3a617081d6fd4b975f587ed5de898e02bd02))
* restore purple merged-PR pill styling in workspace PR rows ([#1924](https://github.com/intent-hq/cloudlands-fe/issues/1924)) ([1daa210](https://github.com/intent-hq/cloudlands-fe/commit/1daa210baf3497d084bab05cecddad9465c7234c))
* uniform spacing for batched system-event rows ([#1925](https://github.com/intent-hq/cloudlands-fe/issues/1925)) ([0928a2c](https://github.com/intent-hq/cloudlands-fe/commit/0928a2c9c2b48585bbe2a7906c3a1e3fa13e6bc7))


### ⚡ Performance

* batch layout reads/writes to eliminate forced reflows on workspace switch ([#1926](https://github.com/intent-hq/cloudlands-fe/issues/1926)) ([0eba390](https://github.com/intent-hq/cloudlands-fe/commit/0eba390a1b6ea29d97d9a7570637aeaa7de15459))
* **store:** cache selector tracking proxies to cut dispatch fan-out cost ([#1915](https://github.com/intent-hq/cloudlands-fe/issues/1915)) ([86277b0](https://github.com/intent-hq/cloudlands-fe/commit/86277b0a6dc856024b6f31525a248087c0ad3317))

## [2.116.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.116.1...v2.116.2) (2026-08-31)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.27 ([#1913](https://github.com/intent-hq/cloudlands-fe/issues/1913)) ([ec7c501](https://github.com/intent-hq/cloudlands-fe/commit/ec7c501f12a157e041882fed2a8866c666848d73))


### ⚡ Performance

* cap in-memory chat transcript at 200 messages ([#1906](https://github.com/intent-hq/cloudlands-fe/issues/1906)) ([aecedaf](https://github.com/intent-hq/cloudlands-fe/commit/aecedafac2e3d64c5616644630c16a8342d4080d))

## [2.116.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.116.0...v2.116.1) (2026-08-30)


### 🐛 Bug Fixes

* New Window inherits the focused window's backend ([#1909](https://github.com/intent-hq/cloudlands-fe/issues/1909)) ([9c51c63](https://github.com/intent-hq/cloudlands-fe/commit/9c51c637d48ea9201c6679b753854dd005e569c2))

## [2.116.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.115.0...v2.116.0) (2026-08-30)


### 🚀 Features

* support slash skill commands in prompt composer ([#1811](https://github.com/intent-hq/cloudlands-fe/issues/1811)) ([c82649f](https://github.com/intent-hq/cloudlands-fe/commit/c82649fc74937b320c55cd79de256d284a116554))

## [2.115.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.114.0...v2.115.0) (2026-08-30)


### 🚀 Features

* **connections:** upgrade support for the local external (non-sidecar) daemon ([#1896](https://github.com/intent-hq/cloudlands-fe/issues/1896)) ([b8e1bfd](https://github.com/intent-hq/cloudlands-fe/commit/b8e1bfd75dfd2e49916fc071610f94d33f05167e))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.26 ([#1908](https://github.com/intent-hq/cloudlands-fe/issues/1908)) ([4bfec8b](https://github.com/intent-hq/cloudlands-fe/commit/4bfec8ba980ffccfa2ab083c2942ea7a075219cb))

## [2.114.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.113.0...v2.114.0) (2026-08-30)


### 🚀 Features

* **release-notes:** open release-notes links directly in the external browser ([#1899](https://github.com/intent-hq/cloudlands-fe/issues/1899)) ([7637928](https://github.com/intent-hq/cloudlands-fe/commit/76379287775cd722a7f0bcb4e3d443f6fedfdece))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.25 ([#1905](https://github.com/intent-hq/cloudlands-fe/issues/1905)) ([d3b9446](https://github.com/intent-hq/cloudlands-fe/commit/d3b9446c97a8f17f7c61b03a2493c7cfd4088c95))


### ⚡ Performance

* **chat:** defer forced-reflow layout reads and focus out of the workspace mount flush ([#1901](https://github.com/intent-hq/cloudlands-fe/issues/1901)) ([89b2388](https://github.com/intent-hq/cloudlands-fe/commit/89b238813ecc83336d79c84e09c3b17ee1b65a6a))
* defer code-block syntax highlighting off the mount flush ([#1903](https://github.com/intent-hq/cloudlands-fe/issues/1903)) ([75ae895](https://github.com/intent-hq/cloudlands-fe/commit/75ae8950113bd09b8b683f2619e7a8204c112d00))
* virtualize user rows so a workspace switch mounts only the displayport ([#1904](https://github.com/intent-hq/cloudlands-fe/issues/1904)) ([96e8fa2](https://github.com/intent-hq/cloudlands-fe/commit/96e8fa2e89430bc9a8c11d68d922fe78cefb2d3e))

## [2.113.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.112.2...v2.113.0) (2026-08-30)


### 🚀 Features

* **hardware-console:** cycle open windows action with CM2 ACT11 default ([#1894](https://github.com/intent-hq/cloudlands-fe/issues/1894)) ([9bb4de8](https://github.com/intent-hq/cloudlands-fe/commit/9bb4de8d8fcfdf4e742891dae2ea9b45ec1e1203))
* **workspace:** warn about open PRs when archiving or deleting a workspace ([#1895](https://github.com/intent-hq/cloudlands-fe/issues/1895)) ([c87c77b](https://github.com/intent-hq/cloudlands-fe/commit/c87c77bade6337c5f5043a649c60109cdf51e96b))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.24 ([#1900](https://github.com/intent-hq/cloudlands-fe/issues/1900)) ([ef75557](https://github.com/intent-hq/cloudlands-fe/commit/ef755574441bfa21c34703665dd011aa0cd474c3))


### ⚡ Performance

* **chat:** render read-only markdown as static HTML without ProseMirror ([#1892](https://github.com/intent-hq/cloudlands-fe/issues/1892)) ([59dffa7](https://github.com/intent-hq/cloudlands-fe/commit/59dffa79425b3d956ca0ac5d0f42b98677acf1e7))
* **sidebar:** delay workspace hover-card mount until pointer rests ([#1893](https://github.com/intent-hq/cloudlands-fe/issues/1893)) ([a285b99](https://github.com/intent-hq/cloudlands-fe/commit/a285b9960b0c25062cc420ca659979700260a08d))

## [2.112.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.112.1...v2.112.2) (2026-08-30)


### 🐛 Bug Fixes

* **smart-scroll:** snap synchronously on resize delivery while following ([#1886](https://github.com/intent-hq/cloudlands-fe/issues/1886)) ([9d881b7](https://github.com/intent-hq/cloudlands-fe/commit/9d881b7ab36a88312f5096b0d6d7db11624ec4e9))

## [2.112.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.112.0...v2.112.1) (2026-08-30)


### 🐛 Bug Fixes

* **chat:** keep on-screen rows hydrated through streaming layout churn ([#1887](https://github.com/intent-hq/cloudlands-fe/issues/1887)) ([0ae8e52](https://github.com/intent-hq/cloudlands-fe/commit/0ae8e52788a63a0c001eed84f8e1938c0160ff58))

## [2.112.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.111.0...v2.112.0) (2026-08-30)


### 🚀 Features

* capture updateSupported and gate the remote Update affordance ([#1881](https://github.com/intent-hq/cloudlands-fe/issues/1881)) ([791b67c](https://github.com/intent-hq/cloudlands-fe/commit/791b67c3c1800774d6f1928b8fed1a2b31d40e15))
* **chat:** display cron and runAt hook schedules in the background-hooks row ([#1884](https://github.com/intent-hq/cloudlands-fe/issues/1884)) ([6e9ee9c](https://github.com/intent-hq/cloudlands-fe/commit/6e9ee9cd17d798a54b8a92d4fda64e41aff77db7))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.22 ([#1883](https://github.com/intent-hq/cloudlands-fe/issues/1883)) ([4c53d27](https://github.com/intent-hq/cloudlands-fe/commit/4c53d27e786ca31756b58227659bf13994227170))
* bump intentd sidecar to v0.8.23 ([#1885](https://github.com/intent-hq/cloudlands-fe/issues/1885)) ([f0f5081](https://github.com/intent-hq/cloudlands-fe/commit/f0f508113fd8e9c7b0846d9ba71ede353bfa7866))
* **voice:** keep composer focus on dictation and target the originating composer ([#1880](https://github.com/intent-hq/cloudlands-fe/issues/1880)) ([c5faaaf](https://github.com/intent-hq/cloudlands-fe/commit/c5faaafa73210ee7a625f282a6dfc707c1195246))

## [2.111.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.110.2...v2.111.0) (2026-08-30)


### 🚀 Features

* default device names to the backend pretty hostname ([#1874](https://github.com/intent-hq/cloudlands-fe/issues/1874)) ([89f13d4](https://github.com/intent-hq/cloudlands-fe/commit/89f13d452e977edd7438a5496efdb2ff3e9b70fb))


### 🐛 Bug Fixes

* **chat:** replay visibility reports that arrive before hydration records exist ([#1876](https://github.com/intent-hq/cloudlands-fe/issues/1876)) ([e1d826c](https://github.com/intent-hq/cloudlands-fe/commit/e1d826cfd5ae809f99e7e86b20c3811756141bd3))
* **connections:** scope daemon-behind-pin toast to the window's own backend ([#1879](https://github.com/intent-hq/cloudlands-fe/issues/1879)) ([3fefbbe](https://github.com/intent-hq/cloudlands-fe/commit/3fefbbee25931a719528d8b0adcd5ceb8ed8acbc))

## [2.110.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.110.1...v2.110.2) (2026-08-30)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.21 ([#1875](https://github.com/intent-hq/cloudlands-fe/issues/1875)) ([8511127](https://github.com/intent-hq/cloudlands-fe/commit/8511127baf6ddf02fe7f0394783650d83f4109ee))
* include thoughtTokens in HUD card token sum; align docs with disjoint-counter convention ([#1873](https://github.com/intent-hq/cloudlands-fe/issues/1873)) ([d92a130](https://github.com/intent-hq/cloudlands-fe/commit/d92a130cf1bf14162acb7113925982bdf0c9ac81))

## [2.110.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.110.0...v2.110.1) (2026-08-29)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.20 ([#1870](https://github.com/intent-hq/cloudlands-fe/issues/1870)) ([0694ed1](https://github.com/intent-hq/cloudlands-fe/commit/0694ed1824623725cffc72624f06781d83e87e3a))

## [2.110.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.109.0...v2.110.0) (2026-08-29)


### 🚀 Features

* animate response-group close and child swap during streaming ([#1866](https://github.com/intent-hq/cloudlands-fe/issues/1866)) ([24e62be](https://github.com/intent-hq/cloudlands-fe/commit/24e62be9e4204fef9f570dd83ce7db98cd442f92))
* behind-pin update indicator and pretty device names on the Devices page ([#1862](https://github.com/intent-hq/cloudlands-fe/issues/1862)) ([d4ffd69](https://github.com/intent-hq/cloudlands-fe/commit/d4ffd69bacf002929463e7920c1b2ef76b96246b))
* **chat:** square image thumbnails with ellipsis actions menu ([#1864](https://github.com/intent-hq/cloudlands-fe/issues/1864)) ([01f452a](https://github.com/intent-hq/cloudlands-fe/commit/01f452a75bdeefb01e7d601492e48eeb0d51fcb8))
* list actual app windows per backend in the Window menu ([#1861](https://github.com/intent-hq/cloudlands-fe/issues/1861)) ([5124d7a](https://github.com/intent-hq/cloudlands-fe/commit/5124d7ab18c9e9c27cc29eabc4335feabb74474b))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.18 ([#1863](https://github.com/intent-hq/cloudlands-fe/issues/1863)) ([41c6a88](https://github.com/intent-hq/cloudlands-fe/commit/41c6a882c4274852468426ab9943f4cf1f17bcc5))
* bump intentd sidecar to v0.8.19 ([#1868](https://github.com/intent-hq/cloudlands-fe/issues/1868)) ([ec9cd65](https://github.com/intent-hq/cloudlands-fe/commit/ec9cd6591fb2b042fa8083e85f01a4500b83e133))
* capture QuestionWizard draftKey at init so teardown never reads null pendingQuestions ([#1857](https://github.com/intent-hq/cloudlands-fe/issues/1857)) ([09124f8](https://github.com/intent-hq/cloudlands-fe/commit/09124f8ec5517c8183d3d381e9d5f7516ab106a4))
* harden keychain-access-groups extraction and guard shared-group signing ([#1865](https://github.com/intent-hq/cloudlands-fe/issues/1865)) ([5a22275](https://github.com/intent-hq/cloudlands-fe/commit/5a2227574bdaf96b387df522a19748916797394b))
* surface hardware console open failures and auto-retry with macOS Input Monitoring guidance ([#1867](https://github.com/intent-hq/cloudlands-fe/issues/1867)) ([29daaca](https://github.com/intent-hq/cloudlands-fe/commit/29daaca4466335c4606f0ea1cc97089a2f7e8615))

## [2.109.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.108.0...v2.109.0) (2026-08-29)


### 🚀 Features

* **hud:** route aligned takeover edges straight through empty cells ([#1856](https://github.com/intent-hq/cloudlands-fe/issues/1856)) ([963df70](https://github.com/intent-hq/cloudlands-fe/commit/963df706c1a5a280276db540bdccdbc9081762b7))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.17 ([#1859](https://github.com/intent-hq/cloudlands-fe/issues/1859)) ([42f1832](https://github.com/intent-hq/cloudlands-fe/commit/42f1832f789127b2d3609703fbdd345e646659f7))


### ⚡ Performance

* **agent-avatar:** apply resize-observed stack width on a later frame ([#1854](https://github.com/intent-hq/cloudlands-fe/issues/1854)) ([4f5a0ca](https://github.com/intent-hq/cloudlands-fe/commit/4f5a0cad346168253af7da4c2e9073530cf9db75))
* **smart-scroll:** defer observer-driven layout work to a coalesced frame ([#1855](https://github.com/intent-hq/cloudlands-fe/issues/1855)) ([9ad0a18](https://github.com/intent-hq/cloudlands-fe/commit/9ad0a18e0b62b0320d2eda670589dc2afc015442))

## [2.108.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.107.0...v2.108.0) (2026-08-29)


### 🚀 Features

* persist Q&A wizard collapsed state and auto-collapse while typing ([#1843](https://github.com/intent-hq/cloudlands-fe/issues/1843)) ([0ee249e](https://github.com/intent-hq/cloudlands-fe/commit/0ee249e28c9e0464b80201545a6e0242f61f11bb))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.16 ([#1853](https://github.com/intent-hq/cloudlands-fe/issues/1853)) ([c5150e9](https://github.com/intent-hq/cloudlands-fe/commit/c5150e96aa086a24c292164eb722522c3c83d30c))
* clean up device status menu ([#1834](https://github.com/intent-hq/cloudlands-fe/issues/1834)) ([41d7c12](https://github.com/intent-hq/cloudlands-fe/commit/41d7c12cce94685bd8d07baa0e87c8a634e0b62f))
* skip window-session tombstoning during app quit/update install ([#1851](https://github.com/intent-hq/cloudlands-fe/issues/1851)) ([2dd7293](https://github.com/intent-hq/cloudlands-fe/commit/2dd729338f7656f0ba8b1bae0b57450574dd2edb))
* **workspace:** clear warm session phases on backend reconnect ([#1847](https://github.com/intent-hq/cloudlands-fe/issues/1847)) ([751e8ee](https://github.com/intent-hq/cloudlands-fe/commit/751e8eef3b10bf99959f0026c86b1663ea39a0cb))


### ⚡ Performance

* **agent-avatar:** defer stack measurement off the mount path ([#1848](https://github.com/intent-hq/cloudlands-fe/issues/1848)) ([98d9a8e](https://github.com/intent-hq/cloudlands-fe/commit/98d9a8efefb756365406cf6c006ed04004dcd29a))
* defer smartScroll bottom snap on retained-surface reactivation ([#1845](https://github.com/intent-hq/cloudlands-fe/issues/1845)) ([8a60044](https://github.com/intent-hq/cloudlands-fe/commit/8a60044f6dfce4685fdb394a3b63efb0499274e5))
* **layout:** skip resize intro measurement on zero-duration plays ([#1849](https://github.com/intent-hq/cloudlands-fe/issues/1849)) ([e6a1c49](https://github.com/intent-hq/cloudlands-fe/commit/e6a1c49f51fa796eb41746dfd16c07c8f541c1fe))

## [2.107.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.106.2...v2.107.0) (2026-08-29)


### 🚀 Features

* persist Q&A wizard answer drafts and current step locally ([#1841](https://github.com/intent-hq/cloudlands-fe/issues/1841)) ([c48a9b1](https://github.com/intent-hq/cloudlands-fe/commit/c48a9b1f14c114301974ef60f4721cad932cbfe9))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.15 ([#1846](https://github.com/intent-hq/cloudlands-fe/issues/1846)) ([69b8ee4](https://github.com/intent-hq/cloudlands-fe/commit/69b8ee490226dd1b4906da63e0ba38b295a6f412))
* **hud:** gate attention panel rows and ATTN counter to top-level non-background agents ([#1837](https://github.com/intent-hq/cloudlands-fe/issues/1837)) ([ec154f0](https://github.com/intent-hq/cloudlands-fe/commit/ec154f041f99c6a45b6f0aa67f869b7f486f44fd))
* match connection accent dot to the daemon status dot (size-2, no ring) ([#1838](https://github.com/intent-hq/cloudlands-fe/issues/1838)) ([8377dcf](https://github.com/intent-hq/cloudlands-fe/commit/8377dcf14dc17c3d0a817680111f0008f34796a2))
* **workspace:** anchor isNotFoundError to the workspace subject ([#1840](https://github.com/intent-hq/cloudlands-fe/issues/1840)) ([9b84088](https://github.com/intent-hq/cloudlands-fe/commit/9b84088312e6324f55c12cc613f49c4241289c48))

## [2.106.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.106.1...v2.106.2) (2026-08-29)


### ⚡ Performance

* **workspace:** skip redundant warm workspace refreshes ([#1829](https://github.com/intent-hq/cloudlands-fe/issues/1829)) ([bca6897](https://github.com/intent-hq/cloudlands-fe/commit/bca6897ed48809ca238f58a76020e364001d162b))

## [2.106.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.106.0...v2.106.1) (2026-08-29)


### 🐛 Bug Fixes

* preserve onboarding prompt draft when navigating away ([#1830](https://github.com/intent-hq/cloudlands-fe/issues/1830)) ([16ce926](https://github.com/intent-hq/cloudlands-fe/commit/16ce9261c9a286c8c1bf2423f0b1490022143486))

## [2.106.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.105.0...v2.106.0) (2026-08-28)


### 🚀 Features

* add reliable full-layout pane drag previews ([#1793](https://github.com/intent-hq/cloudlands-fe/issues/1793)) ([780b7c8](https://github.com/intent-hq/cloudlands-fe/commit/780b7c84918cd52f6a57fa652870a4a2eb6b2e7a))
* add vulnerability scanner fallback ([#1773](https://github.com/intent-hq/cloudlands-fe/issues/1773)) ([7778bb6](https://github.com/intent-hq/cloudlands-fe/commit/7778bb6d8bfdd8c863d6811f816c29dd9f13d191))
* **chat:** simplify model picker reasoning controls ([#1815](https://github.com/intent-hq/cloudlands-fe/issues/1815)) ([eb2da9a](https://github.com/intent-hq/cloudlands-fe/commit/eb2da9a40de137ce0a5194db904acbd9095e6fb1))
* redesign remote Devices settings ([#1816](https://github.com/intent-hq/cloudlands-fe/issues/1816)) ([2db94cf](https://github.com/intent-hq/cloudlands-fe/commit/2db94cfaee4a5169750824c7b436bcdca2e0495a))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.13 ([#1826](https://github.com/intent-hq/cloudlands-fe/issues/1826)) ([1c5b4e6](https://github.com/intent-hq/cloudlands-fe/commit/1c5b4e60f2aaf51f3830177c7290322c664edbbe))
* bump intentd sidecar to v0.8.14 ([#1831](https://github.com/intent-hq/cloudlands-fe/issues/1831)) ([e9bf139](https://github.com/intent-hq/cloudlands-fe/commit/e9bf1395ddbf1e9e57869b56c0058b8cea6d77ae))
* reconcile per-window workspace attention so hardware unread-cycle keys don't skip or pin ([#1814](https://github.com/intent-hq/cloudlands-fe/issues/1814)) ([632a4f6](https://github.com/intent-hq/cloudlands-fe/commit/632a4f6ea9c7243cefc7067bb0f6300a5049fd62))

## [2.105.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.104.0...v2.105.0) (2026-08-28)


### 🚀 Features

* remove the whole-app backend switch flow ([#1819](https://github.com/intent-hq/cloudlands-fe/issues/1819)) ([507cfff](https://github.com/intent-hq/cloudlands-fe/commit/507cfffea05367182b1e88371d31f7ceb9ef87a8))
* rework daemon-stopped overlay recovery to Open-only actions ([#1818](https://github.com/intent-hq/cloudlands-fe/issues/1818)) ([30499db](https://github.com/intent-hq/cloudlands-fe/commit/30499dbe86da39be37c1cc9b53ab46ba7c81c8db))

## [2.104.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.103.0...v2.104.0) (2026-08-28)


### 🚀 Features

* add Chief cross-workspace messaging UI ([#1794](https://github.com/intent-hq/cloudlands-fe/issues/1794)) ([9cc107e](https://github.com/intent-hq/cloudlands-fe/commit/9cc107ebaec1631d37468a8602632939adf6a9d4))
* restore every backend's saved windows at boot and dock-activate ([#1805](https://github.com/intent-hq/cloudlands-fe/issues/1805)) ([c9c79c0](https://github.com/intent-hq/cloudlands-fe/commit/c9c79c041919f1119a1453889d9058c8b23d1f40))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.12 ([#1813](https://github.com/intent-hq/cloudlands-fe/issues/1813)) ([5b13eb9](https://github.com/intent-hq/cloudlands-fe/commit/5b13eb995eee85867b19364edcb3771013cb97c8))
* detect onboarding default branch ([#1799](https://github.com/intent-hq/cloudlands-fe/issues/1799)) ([e4ff578](https://github.com/intent-hq/cloudlands-fe/commit/e4ff578cd8dab09eba116db686836659fe730c06))
* hide the dead fork button in chat message actions ([#1808](https://github.com/intent-hq/cloudlands-fe/issues/1808)) ([1e8a809](https://github.com/intent-hq/cloudlands-fe/commit/1e8a809af190f7817664ec07014c720d79918b8d))

## [2.103.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.102.0...v2.103.0) (2026-08-28)


### 🚀 Features

* remote daemon version capture + Update action for behind remote backends ([#1807](https://github.com/intent-hq/cloudlands-fe/issues/1807)) ([897c9ce](https://github.com/intent-hq/cloudlands-fe/commit/897c9ce481bbad290d2939a79f3a6f0d2f3cef3b))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.11 ([#1809](https://github.com/intent-hq/cloudlands-fe/issues/1809)) ([fd2b163](https://github.com/intent-hq/cloudlands-fe/commit/fd2b163266d2f3f6ae590bdaf2472695cdc4825b))
* close stale agent tabs on agent-not-found instead of showing hydration error ([#1804](https://github.com/intent-hq/cloudlands-fe/issues/1804)) ([de7d490](https://github.com/intent-hq/cloudlands-fe/commit/de7d490e9d5b3e040cdcba113184d133683e199c))

## [2.102.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.101.4...v2.102.0) (2026-08-28)


### 🚀 Features

* **backend:** dispose pooled client on last window close ([#1788](https://github.com/intent-hq/cloudlands-fe/issues/1788)) ([732ef75](https://github.com/intent-hq/cloudlands-fe/commit/732ef7523393d36d13730fe4ae0d73f3684b50ef))
* **backend:** per-backend cert/auth/protocol-mismatch wiring on pooled clients ([#1798](https://github.com/intent-hq/cloudlands-fe/issues/1798)) ([b4a4d47](https://github.com/intent-hq/cloudlands-fe/commit/b4a4d4743144f1cdd9cde50eaf7bee5a00be0e7f))
* bind the HUD to the opener's backend (per-backend HUD singleton) ([#1786](https://github.com/intent-hq/cloudlands-fe/issues/1786)) ([b54f146](https://github.com/intent-hq/cloudlands-fe/commit/b54f1461bfc40e8363c5333f4b6dbc7fb558d036))


### 🐛 Bug Fixes

* migrate primary-keyed main-process services to per-backend/local-only routing ([#1790](https://github.com/intent-hq/cloudlands-fe/issues/1790)) ([5578679](https://github.com/intent-hq/cloudlands-fe/commit/55786795a6db9850b0cbba4e0d9667f89883ccab))


### ⚡ Performance

* preserve workspace sessions across tab focus ([#1802](https://github.com/intent-hq/cloudlands-fe/issues/1802)) ([befa89d](https://github.com/intent-hq/cloudlands-fe/commit/befa89ddbe907e8c286f5905b4b6533000e609a8))

## [2.101.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.101.3...v2.101.4) (2026-08-28)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.10 ([#1800](https://github.com/intent-hq/cloudlands-fe/issues/1800)) ([a0376ef](https://github.com/intent-hq/cloudlands-fe/commit/a0376efea30b226006377deafb98be8eb7bbc1e4))

## [2.101.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.101.2...v2.101.3) (2026-08-27)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.9 ([#1796](https://github.com/intent-hq/cloudlands-fe/issues/1796)) ([df88c70](https://github.com/intent-hq/cloudlands-fe/commit/df88c70d5917bda292be337441841dccbfc8580a))
* reconcile agent provider and model selection ([#1795](https://github.com/intent-hq/cloudlands-fe/issues/1795)) ([f49d315](https://github.com/intent-hq/cloudlands-fe/commit/f49d315dd6ed09e1aaaac02aba545e70dbb3cf99))

## [2.101.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.101.1...v2.101.2) (2026-08-27)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.8 ([#1791](https://github.com/intent-hq/cloudlands-fe/issues/1791)) ([fabf4eb](https://github.com/intent-hq/cloudlands-fe/commit/fabf4eb47c9b0adc96a40b85edd2e60812ebb1bc))

## [2.101.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.101.0...v2.101.1) (2026-08-27)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.7 ([#1784](https://github.com/intent-hq/cloudlands-fe/issues/1784)) ([de6838e](https://github.com/intent-hq/cloudlands-fe/commit/de6838e6fffbca853e778bb303b63cd928aa0b58))

## [2.101.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.100.0...v2.101.0) (2026-08-27)


### 🚀 Features

* add fast UI previews and secure media workflows ([#1705](https://github.com/intent-hq/cloudlands-fe/issues/1705)) ([534ae59](https://github.com/intent-hq/cloudlands-fe/commit/534ae59733ff27aac12689a90c7ed038bc4fca16))
* add Replace Agent hand-off action to agent menus ([#1772](https://github.com/intent-hq/cloudlands-fe/issues/1772)) ([5625dc3](https://github.com/intent-hq/cloudlands-fe/commit/5625dc30be0d9c2a5340796f12b07b8c715b80c8))
* improve workspace tab drag motion ([#1754](https://github.com/intent-hq/cloudlands-fe/issues/1754)) ([030c30a](https://github.com/intent-hq/cloudlands-fe/commit/030c30a63323a963bd1c5c56344fbaa959d93c4d))
* lazy retired bin — count-first render, load rows on expand ([#1774](https://github.com/intent-hq/cloudlands-fe/issues/1774)) ([1b5235b](https://github.com/intent-hq/cloudlands-fe/commit/1b5235bceceaa4201b3bf0a855bfff3f5cd4586a))
* log app build identity at startup and daemon build on connect ([#1776](https://github.com/intent-hq/cloudlands-fe/issues/1776)) ([9446862](https://github.com/intent-hq/cloudlands-fe/commit/94468622ac31490a2fac7c440e2aed68da97afaa))
* move keychain sync items to a shared access group ([#1765](https://github.com/intent-hq/cloudlands-fe/issues/1765)) ([5ec90c2](https://github.com/intent-hq/cloudlands-fe/commit/5ec90c250cf0d895e7d1c59e96280b94770212b9))
* refine agent panel UI ([#1707](https://github.com/intent-hq/cloudlands-fe/issues/1707)) ([f75680f](https://github.com/intent-hq/cloudlands-fe/commit/f75680ff1266674eefefd0ee4d088624aa59814d))
* render auto_unarchived system row as subtle inline divider ([#1767](https://github.com/intent-hq/cloudlands-fe/issues/1767)) ([b6f8175](https://github.com/intent-hq/cloudlands-fe/commit/b6f81754d1273c12f9aec27a5289c852390b0e3f))
* replace includeRetired with retiredOnly + retiredCount in agents client seam ([#1766](https://github.com/intent-hq/cloudlands-fe/issues/1766)) ([fe3a23e](https://github.com/intent-hq/cloudlands-fe/commit/fe3a23ec3da198083b7676a7d831cc217a47ba74))


### 🐛 Bug Fixes

* add space below expanded chat groups ([#1769](https://github.com/intent-hq/cloudlands-fe/issues/1769)) ([42b193e](https://github.com/intent-hq/cloudlands-fe/commit/42b193eb8507d1adf9fa4a3465e2ded511d0ccda))
* bump intentd sidecar to v0.8.5 ([#1778](https://github.com/intent-hq/cloudlands-fe/issues/1778)) ([908a3e9](https://github.com/intent-hq/cloudlands-fe/commit/908a3e9491616e8af687a1ffcd8a5713983d1caf))
* bump intentd sidecar to v0.8.6 ([#1783](https://github.com/intent-hq/cloudlands-fe/issues/1783)) ([a720463](https://github.com/intent-hq/cloudlands-fe/commit/a7204630119033755f3609e5dea10a33084fbe5b))
* complete grouped thinking blocks ([#1574](https://github.com/intent-hq/cloudlands-fe/issues/1574)) ([6692562](https://github.com/intent-hq/cloudlands-fe/commit/669256239bbe45deadb4eb7bc0dcb300eb763d1a))
* disable publishing for manual macOS builds ([#1727](https://github.com/intent-hq/cloudlands-fe/issues/1727)) ([049a3c5](https://github.com/intent-hq/cloudlands-fe/commit/049a3c57c0032189a3925e1bb4861ab568d26a22))
* hide connections matching the live local daemon fingerprint ([#1779](https://github.com/intent-hq/cloudlands-fe/issues/1779)) ([9c4d8e7](https://github.com/intent-hq/cloudlands-fe/commit/9c4d8e7390ee3b387d935125c4d51084b2c46d53))
* make tunnel-manager refused-OPEN tests deterministic ([#1768](https://github.com/intent-hq/cloudlands-fe/issues/1768)) ([a185c39](https://github.com/intent-hq/cloudlands-fe/commit/a185c39946e64993aa50edb105e50c9024f42d49))
* preflight workspace transfer destination ([#1736](https://github.com/intent-hq/cloudlands-fe/issues/1736)) ([3488f05](https://github.com/intent-hq/cloudlands-fe/commit/3488f05780366e50204ebb116aea601819cdff9e))


### ⚡ Performance

* Cache unchanged ESLint results ([#1756](https://github.com/intent-hq/cloudlands-fe/issues/1756)) ([0131234](https://github.com/intent-hq/cloudlands-fe/commit/0131234e2ff427d06ea95eac6ea19b6604d1113c))

## [2.100.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.99.1...v2.100.0) (2026-08-27)


### 🚀 Features

* default-on iCloud keychain sync with per-backend opt-out ([#1762](https://github.com/intent-hq/cloudlands-fe/issues/1762)) ([e424b0b](https://github.com/intent-hq/cloudlands-fe/commit/e424b0bcabf43124aa75e0a0e12d5688ff6fd08e))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.4 ([#1764](https://github.com/intent-hq/cloudlands-fe/issues/1764)) ([8367e90](https://github.com/intent-hq/cloudlands-fe/commit/8367e90a0b37524e7739b74f4668f7b712457d71))

## [2.99.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.99.0...v2.99.1) (2026-08-27)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.3 ([#1761](https://github.com/intent-hq/cloudlands-fe/issues/1761)) ([7a7922f](https://github.com/intent-hq/cloudlands-fe/commit/7a7922fa8b3c4e74f844599875f76cdbc439d73a))
* expand loading glow across agent panel ([#1759](https://github.com/intent-hq/cloudlands-fe/issues/1759)) ([b112cca](https://github.com/intent-hq/cloudlands-fe/commit/b112cca66c9a65344855f15f22933e6d4e8ba27a))
* prevent collapsed sidebar edge bleed ([#1758](https://github.com/intent-hq/cloudlands-fe/issues/1758)) ([f352c22](https://github.com/intent-hq/cloudlands-fe/commit/f352c22cbd8e56bc20f6d17ee26fa822a8647821))

## [2.99.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.98.0...v2.99.0) (2026-08-26)


### 🚀 Features

* reorganize settings navigation ([#1737](https://github.com/intent-hq/cloudlands-fe/issues/1737)) ([7b81eb9](https://github.com/intent-hq/cloudlands-fe/commit/7b81eb9b6d7d14f931dc4b60116a856ee5b7c523))

## [2.98.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.97.1...v2.98.0) (2026-08-26)


### 🚀 Features

* adopt slim note.list projection + targeted note.get refetch ([#1750](https://github.com/intent-hq/cloudlands-fe/issues/1750)) ([ffc42ab](https://github.com/intent-hq/cloudlands-fe/commit/ffc42abd3c7a43483c3fc97589cbd605d9a208d0))
* publish self backend to iCloud Keychain when WSS API is enabled ([#1744](https://github.com/intent-hq/cloudlands-fe/issues/1744)) ([f03009b](https://github.com/intent-hq/cloudlands-fe/commit/f03009b91c1415a1f9a45860f7704d5472535555))
* show queued-to-merge status on the monitored-PR row ([#1747](https://github.com/intent-hq/cloudlands-fe/issues/1747)) ([7e57536](https://github.com/intent-hq/cloudlands-fe/commit/7e5753631de6452c59f3ee7466f888adccf996f9))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.1 ([#1748](https://github.com/intent-hq/cloudlands-fe/issues/1748)) ([7580336](https://github.com/intent-hq/cloudlands-fe/commit/75803367ff9754497d823ed502ff2a698da97826))
* bump intentd sidecar to v0.8.2 ([#1755](https://github.com/intent-hq/cloudlands-fe/issues/1755)) ([99aea27](https://github.com/intent-hq/cloudlands-fe/commit/99aea27d61d2d4a32efa305b628ad548d0e26e94))
* filter WorkspaceHoverCard unread avatars to top-level agents ([#1753](https://github.com/intent-hq/cloudlands-fe/issues/1753)) ([0ed00b0](https://github.com/intent-hq/cloudlands-fe/commit/0ed00b0a0912852d34f2c58ccce4c0b0b64fd413))
* keep automated wake header on one line with ellipsis truncation ([#1751](https://github.com/intent-hq/cloudlands-fe/issues/1751)) ([cea7233](https://github.com/intent-hq/cloudlands-fe/commit/cea7233da5128b757f79a14011e09254f7e23fbb))
* reorder Status view sections to canonical lifecycle order ([#1752](https://github.com/intent-hq/cloudlands-fe/issues/1752)) ([b95bfbb](https://github.com/intent-hq/cloudlands-fe/commit/b95bfbb804ab950127459c67dfc496b9468d181f))
* resolve remote localhost links with originating backend ([#1719](https://github.com/intent-hq/cloudlands-fe/issues/1719)) ([84fbf86](https://github.com/intent-hq/cloudlands-fe/commit/84fbf86433a94d8b34d0d91d7ebfde7da0b5dcb8))

## [2.97.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.97.0...v2.97.1) (2026-08-26)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.8.0 ([#1746](https://github.com/intent-hq/cloudlands-fe/issues/1746)) ([ea174e0](https://github.com/intent-hq/cloudlands-fe/commit/ea174e07c285ebada38a481136503d5fd9584c97))
* refetch workspace list on workspace:created for an unknown ID ([#1740](https://github.com/intent-hq/cloudlands-fe/issues/1740)) ([03a6195](https://github.com/intent-hq/cloudlands-fe/commit/03a6195ea9a89b23e27dcecb64f787161afc5287))

## [2.97.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.96.0...v2.97.0) (2026-08-26)


### 🚀 Features

* show specialist role in agent context menu ([#1722](https://github.com/intent-hq/cloudlands-fe/issues/1722)) ([67e166e](https://github.com/intent-hq/cloudlands-fe/commit/67e166e4aa54d667d6bb27a4751a0711592ff72e))


### 🐛 Bug Fixes

* always strip well-formed suggested-prompts blocks and salvage valid prompts ([#1728](https://github.com/intent-hq/cloudlands-fe/issues/1728)) ([705cae5](https://github.com/intent-hq/cloudlands-fe/commit/705cae5e95ef88ea63f624be9cbe9b6d5bbce6a0))
* gate dev Electron launch on the generated SvelteKit client being servable ([#1731](https://github.com/intent-hq/cloudlands-fe/issues/1731)) ([c78aae2](https://github.com/intent-hq/cloudlands-fe/commit/c78aae2045fe7cf07a6ab8a3a10f70e2b1a8d863))
* only derive per-agent unread for top-level foreground agents ([#1739](https://github.com/intent-hq/cloudlands-fe/issues/1739)) ([8643d0b](https://github.com/intent-hq/cloudlands-fe/commit/8643d0bb5a0e594875bd5bcffdad459dd04d1589))
* pin transfer/import relay sessions to the invoking window ([#1725](https://github.com/intent-hq/cloudlands-fe/issues/1725)) ([9b2c89e](https://github.com/intent-hq/cloudlands-fe/commit/9b2c89ee5f64c5243647a09073e5b90ccb9b11ab))
* prevent fused prompt closer stream flash ([#1729](https://github.com/intent-hq/cloudlands-fe/issues/1729)) ([c0c088c](https://github.com/intent-hq/cloudlands-fe/commit/c0c088c028946f398b0d13d13f0bc4dc814a6603))
* prioritize hydration reads for the currently focused workspace tab ([#1735](https://github.com/intent-hq/cloudlands-fe/issues/1735)) ([ff70e71](https://github.com/intent-hq/cloudlands-fe/commit/ff70e7185556ba3c1fa5d338e0dfd7eacb61303b))
* stop forwarding console output to broken stdio streams ([#1726](https://github.com/intent-hq/cloudlands-fe/issues/1726)) ([01b7c1a](https://github.com/intent-hq/cloudlands-fe/commit/01b7c1a4a73c2c8110a11e86be0a3b14c334b24c))
* truncate long issue/PR titles in workspace context suggestions ([#1733](https://github.com/intent-hq/cloudlands-fe/issues/1733)) ([26e6d66](https://github.com/intent-hq/cloudlands-fe/commit/26e6d6653ca8bfa72b97fc71753db88e08a5d4e8))

## [2.96.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.95.0...v2.96.0) (2026-08-26)


### 🚀 Features

* add deterministic UI previews and polish hover cards ([#1701](https://github.com/intent-hq/cloudlands-fe/issues/1701)) ([02cfdf0](https://github.com/intent-hq/cloudlands-fe/commit/02cfdf007c173c7ad6c24d543bb4df538f059910))
* add live-stream phase gates and slowest-gate attribution to switch timing ([#1723](https://github.com/intent-hq/cloudlands-fe/issues/1723)) ([f557789](https://github.com/intent-hq/cloudlands-fe/commit/f5577894d4d30b00cd160f9bce68b19037386569))
* add sibling workspace proposal card mode ([#1667](https://github.com/intent-hq/cloudlands-fe/issues/1667)) ([70892a2](https://github.com/intent-hq/cloudlands-fe/commit/70892a2299a7299f6f7bfbbbe4ebb5c4a442878a))
* show cumulative release notes after updates ([#1699](https://github.com/intent-hq/cloudlands-fe/issues/1699)) ([594f133](https://github.com/intent-hq/cloudlands-fe/commit/594f1338a767e00563e5a734bf617206e54b15c5))
* sync remote backend connections across Macs via iCloud Keychain ([#1715](https://github.com/intent-hq/cloudlands-fe/issues/1715)) ([ccdca5f](https://github.com/intent-hq/cloudlands-fe/commit/ccdca5fd349f3e03389f96d135b0db585084ce9b))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.62 ([#1734](https://github.com/intent-hq/cloudlands-fe/issues/1734)) ([be679a6](https://github.com/intent-hq/cloudlands-fe/commit/be679a6d1f30175c33b1238c63877ff908cecdd1))
* gate live tool preview on canonical running evidence ([#1730](https://github.com/intent-hq/cloudlands-fe/issues/1730)) ([20a6713](https://github.com/intent-hq/cloudlands-fe/commit/20a6713ecb6590fa19d2d58dbffbc92454c9c0ae))
* honor openInNewAdjacentPanel for mod-clicked note task links ([#1718](https://github.com/intent-hq/cloudlands-fe/issues/1718)) ([3266c3f](https://github.com/intent-hq/cloudlands-fe/commit/3266c3f3c2d63998d88a06801b0feff9458d2046))
* keep stacked toasts expanded and restyle warning toasts for dark theme ([#1633](https://github.com/intent-hq/cloudlands-fe/issues/1633)) ([a6a579d](https://github.com/intent-hq/cloudlands-fe/commit/a6a579dc1412bbbf481a578d5cf6b33a75b4a5fb))
* mark sessions live on agent:stream:activity pings ([#1724](https://github.com/intent-hq/cloudlands-fe/issues/1724)) ([c0e88c8](https://github.com/intent-hq/cloudlands-fe/commit/c0e88c86cd539463e6a137f072014031d9c1f226))
* match packaged macOS Dock icon ([#1662](https://github.com/intent-hq/cloudlands-fe/issues/1662)) ([f70a7a6](https://github.com/intent-hq/cloudlands-fe/commit/f70a7a6ad92dc898c15bff0dc101c9d41b7d8853))

## [2.95.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.94.0...v2.95.0) (2026-08-26)


### 🚀 Features

* add Disabled update channel to opt out of auto-updates ([#1713](https://github.com/intent-hq/cloudlands-fe/issues/1713)) ([c68094e](https://github.com/intent-hq/cloudlands-fe/commit/c68094eed3eed079daa3e38ea60651932c49bed4))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.61 ([#1720](https://github.com/intent-hq/cloudlands-fe/issues/1720)) ([aebfc35](https://github.com/intent-hq/cloudlands-fe/commit/aebfc355a2edb5587857d89f5a3f81c92b0ee23c))
* resolve transfer/import client from the invoking window's backend ([#1716](https://github.com/intent-hq/cloudlands-fe/issues/1716)) ([0035a03](https://github.com/intent-hq/cloudlands-fe/commit/0035a033e8b1832549a90b57288a6a9068c4f6c0))

## [2.94.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.93.1...v2.94.0) (2026-08-26)


### 🚀 Features

* metadata-driven New Workspace modal and specialist icons ([#1700](https://github.com/intent-hq/cloudlands-fe/issues/1700)) ([45f1b16](https://github.com/intent-hq/cloudlands-fe/commit/45f1b168165e9ca18b5cc4a6cefbbed587f3975e))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.59 ([#1712](https://github.com/intent-hq/cloudlands-fe/issues/1712)) ([0d82d3c](https://github.com/intent-hq/cloudlands-fe/commit/0d82d3c27d3603afa1dd3642d9e335b343d17ff3))
* bump intentd sidecar to v0.7.60 ([#1714](https://github.com/intent-hq/cloudlands-fe/issues/1714)) ([74f4701](https://github.com/intent-hq/cloudlands-fe/commit/74f4701f413dbf63ce3809f55815a88f99a8d46e))
* **chief:** gate Chief thread auto-start on a resolvable provider ([#1697](https://github.com/intent-hq/cloudlands-fe/issues/1697)) ([5f6db03](https://github.com/intent-hq/cloudlands-fe/commit/5f6db03c70e688bf4521603373abe3c8091f10c4))
* label sidebar browser-tab groups with the owner agent's name ([#1711](https://github.com/intent-hq/cloudlands-fe/issues/1711)) ([a9df19c](https://github.com/intent-hq/cloudlands-fe/commit/a9df19c4d7f7d2aff990685f7406bdea82d2734c))
* release the followed-bottom lease when a disclosure outro delivers a single tick ([#1692](https://github.com/intent-hq/cloudlands-fe/issues/1692)) ([2719427](https://github.com/intent-hq/cloudlands-fe/commit/2719427da7ad2eb356bf224a47739db5bc752460))
* route into provider setup when the active backend has no ready provider ([#1698](https://github.com/intent-hq/cloudlands-fe/issues/1698)) ([f92ce78](https://github.com/intent-hq/cloudlands-fe/commit/f92ce78c8f7fbdb579d431929c07d8a71eb84b29))
* route workspace-file:// and workspace-asset:// through the workspace-owning backend ([#1710](https://github.com/intent-hq/cloudlands-fe/issues/1710)) ([b23a2b0](https://github.com/intent-hq/cloudlands-fe/commit/b23a2b09a7db7a77045dca4c383569e3c0f05c4d))
* **settings:** scope active-provider state and enablement seeding per backend ([#1696](https://github.com/intent-hq/cloudlands-fe/issues/1696)) ([cf211aa](https://github.com/intent-hq/cloudlands-fe/commit/cf211aa29d88f513acabafe241c2401fb3a4b693))

## [2.93.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.93.0...v2.93.1) (2026-08-25)


### 🐛 Bug Fixes

* show the correct intentd connection per window ([#1706](https://github.com/intent-hq/cloudlands-fe/issues/1706)) ([e53783d](https://github.com/intent-hq/cloudlands-fe/commit/e53783d0dde00cc8e4379426c1c5507837adb0e0))

## [2.93.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.92.0...v2.93.0) (2026-08-25)


### 🚀 Features

* support per-window backend connections ([#1572](https://github.com/intent-hq/cloudlands-fe/issues/1572)) ([eb03c0f](https://github.com/intent-hq/cloudlands-fe/commit/eb03c0f564653632a6684e3a97b39c172a81557d))

## [2.92.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.91.0...v2.92.0) (2026-08-25)


### 🚀 Features

* expose agents.maxTopLevelAgents and agentFeatures.peerAgents in settings UI ([#1673](https://github.com/intent-hq/cloudlands-fe/issues/1673)) ([1db17cb](https://github.com/intent-hq/cloudlands-fe/commit/1db17cb1f8cef407cb90ffcfbf09d92679ad9562))
* retired agents bin with restore and read-only conversations ([#1675](https://github.com/intent-hq/cloudlands-fe/issues/1675)) ([7ec7832](https://github.com/intent-hq/cloudlands-fe/commit/7ec78321222f80c598147b6e872d7b59de73c425))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.58 ([#1703](https://github.com/intent-hq/cloudlands-fe/issues/1703)) ([6a6d0f6](https://github.com/intent-hq/cloudlands-fe/commit/6a6d0f6dd5ebbf063e7b5706d2e49900e79b5c07))
* make automated-wake header bar fully clickable ([#1693](https://github.com/intent-hq/cloudlands-fe/issues/1693)) ([82c5b6e](https://github.com/intent-hq/cloudlands-fe/commit/82c5b6e1de9130cae811332302132699b3c89515))

## [2.91.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.90.0...v2.91.0) (2026-08-25)


### 🚀 Features

* show blue unread dot for unread top-level agents in the sidebar ([#1688](https://github.com/intent-hq/cloudlands-fe/issues/1688)) ([b0cc913](https://github.com/intent-hq/cloudlands-fe/commit/b0cc913afcdc4f74d4904b96bca5056f9d98c4ad))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.57 ([#1694](https://github.com/intent-hq/cloudlands-fe/issues/1694)) ([dbf05f6](https://github.com/intent-hq/cloudlands-fe/commit/dbf05f6ed4212246b99ee51681a4b97de09391c6))
* refresh external-daemon version info on every client.hello ([#1691](https://github.com/intent-hq/cloudlands-fe/issues/1691)) ([c1f8fac](https://github.com/intent-hq/cloudlands-fe/commit/c1f8fac2b7fda41ac58e2f0eb3a87ce82bcc119a))

## [2.90.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.89.0...v2.90.0) (2026-08-25)


### 🚀 Features

* **backend:** prefer prettyHostname when labeling remote connections ([#1682](https://github.com/intent-hq/cloudlands-fe/issues/1682)) ([370b339](https://github.com/intent-hq/cloudlands-fe/commit/370b339c60b4ff73392b8d9c9bc18303eab79dda))
* refine agent settings layout and remove Ralph ([#1671](https://github.com/intent-hq/cloudlands-fe/issues/1671)) ([24bb31b](https://github.com/intent-hq/cloudlands-fe/commit/24bb31b4b33cf87787c1d81b7baddc9cc48ca10e))
* render stalled-stream indicator with Cancel affordance ([#1679](https://github.com/intent-hq/cloudlands-fe/issues/1679)) ([a1d0d45](https://github.com/intent-hq/cloudlands-fe/commit/a1d0d4505214f242ece400a3e6dd79713d09e27f))
* retry a stalled turn from the streaming-status warn row ([#1680](https://github.com/intent-hq/cloudlands-fe/issues/1680)) ([862b256](https://github.com/intent-hq/cloudlands-fe/commit/862b256d0d042526b1f6cb5e41667a2667e7d4ca))
* **settings:** render daemon tokenImpact annotations on agent feature toggles ([#1683](https://github.com/intent-hq/cloudlands-fe/issues/1683)) ([fff35ff](https://github.com/intent-hq/cloudlands-fe/commit/fff35ffac8fb36f6a43d0e74129026f4164b659c))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.56 ([#1685](https://github.com/intent-hq/cloudlands-fe/issues/1685)) ([0759c31](https://github.com/intent-hq/cloudlands-fe/commit/0759c31db6e3d1bbdc50e7210df63970b7b07ce0))
* **chat:** chain-scoped older-history indicator, walk-termination tests, and scrollback reset on transcript discard ([#1681](https://github.com/intent-hq/cloudlands-fe/issues/1681)) ([9e3e145](https://github.com/intent-hq/cloudlands-fe/commit/9e3e145ec198047452e2f6959d28371aff95bfcf))
* **chat:** inset rich blocks to match assistant prose margins ([#1678](https://github.com/intent-hq/cloudlands-fe/issues/1678)) ([b5ae3ee](https://github.com/intent-hq/cloudlands-fe/commit/b5ae3ee8d24ea1e022b04650c30f850971df7b42))
* drive disclosure motion from tick so bottom lock holds during rapid toggles ([#1687](https://github.com/intent-hq/cloudlands-fe/issues/1687)) ([fede74b](https://github.com/intent-hq/cloudlands-fe/commit/fede74b4b34ce50e1a0441ffeb539b87182f1ce5))
* keep offscreen webview guests painting so screenshot cannot hang ([#1674](https://github.com/intent-hq/cloudlands-fe/issues/1674)) ([351dff9](https://github.com/intent-hq/cloudlands-fe/commit/351dff9169ff13d2850b392e1d5be8f556bfbe81))
* reconcile provider model before agent creation ([#1665](https://github.com/intent-hq/cloudlands-fe/issues/1665)) ([192868f](https://github.com/intent-hq/cloudlands-fe/commit/192868fc115ec398032fbfd8b14ee1cd51b511a8))
* regroup message-resumed agents out of the finished section ([#1686](https://github.com/intent-hq/cloudlands-fe/issues/1686)) ([073b850](https://github.com/intent-hq/cloudlands-fe/commit/073b850b7ffc15ac53a7a8a71b36b394169b771d))


### ⚡ Performance

* **chat:** virtualize messages and retain sidebar panels ([#1668](https://github.com/intent-hq/cloudlands-fe/issues/1668)) ([1611c8b](https://github.com/intent-hq/cloudlands-fe/commit/1611c8b5a59ba7b5ed2b7ef2350c24ce57ae1139))

## [2.89.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.88.3...v2.89.0) (2026-08-24)


### 🚀 Features

* hardware unread cycle visits each unread top-level agent ([#1658](https://github.com/intent-hq/cloudlands-fe/issues/1658)) ([323c9b7](https://github.com/intent-hq/cloudlands-fe/commit/323c9b7ec9e98c5a16886b84ad8d4a83665771d2))
* pre-upload images via attachment path and send image-reference blocks ([#1655](https://github.com/intent-hq/cloudlands-fe/issues/1655)) ([98066fc](https://github.com/intent-hq/cloudlands-fe/commit/98066fc8b021412c8ebcf66b0c101ebe7635e2bd))
* stop clearing workspace unread on plain workspace view ([#1659](https://github.com/intent-hq/cloudlands-fe/issues/1659)) ([7c87ca9](https://github.com/intent-hq/cloudlands-fe/commit/7c87ca9cdc12fd64ce7fe4473eb1a6fecad575ca))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.55 ([#1672](https://github.com/intent-hq/cloudlands-fe/issues/1672)) ([c46a5a1](https://github.com/intent-hq/cloudlands-fe/commit/c46a5a1a8bb48126b1fffc3578abd938304d4d49))
* polish desktop UI ([#1552](https://github.com/intent-hq/cloudlands-fe/issues/1552)) ([668dd5c](https://github.com/intent-hq/cloudlands-fe/commit/668dd5c2cda44d449b5a0b77ff67050dce2aaf0c))

## [2.88.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.88.2...v2.88.3) (2026-08-24)


### 🐛 Bug Fixes

* accept dotted GitHub repository names ([#1666](https://github.com/intent-hq/cloudlands-fe/issues/1666)) ([855de9d](https://github.com/intent-hq/cloudlands-fe/commit/855de9d0cd19fecf47e128fef403c63c29425959))

## [2.88.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.88.1...v2.88.2) (2026-08-24)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.54 ([#1663](https://github.com/intent-hq/cloudlands-fe/issues/1663)) ([2bc1e24](https://github.com/intent-hq/cloudlands-fe/commit/2bc1e2455ebe2a2550e983d44f40cd73d9e38239))

## [2.88.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.88.0...v2.88.1) (2026-08-24)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.53 ([#1661](https://github.com/intent-hq/cloudlands-fe/issues/1661)) ([25f989f](https://github.com/intent-hq/cloudlands-fe/commit/25f989fac1a8d42c383d51fa33a0b9b45dab4c9b))


### ⚡ Performance

* **workspace:** coalesce tab hydration and preserve sessions ([#1656](https://github.com/intent-hq/cloudlands-fe/issues/1656)) ([9f0655e](https://github.com/intent-hq/cloudlands-fe/commit/9f0655e6f1af6ccffe7a0019e53f5d00f2728e1c))

## [2.88.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.87.1...v2.88.0) (2026-08-24)


### 🚀 Features

* render inline markdown workspace-file images with lightbox ([#1653](https://github.com/intent-hq/cloudlands-fe/issues/1653)) ([67c2d78](https://github.com/intent-hq/cloudlands-fe/commit/67c2d789b7f3ab5985618125ca1454ad7cefd114))
* serve workspace image files over a workspace-file:// protocol ([#1650](https://github.com/intent-hq/cloudlands-fe/issues/1650)) ([00671a2](https://github.com/intent-hq/cloudlands-fe/commit/00671a2fe729d8e73f910b9a42079cd5457c332a))
* support intent file links to open files in the workspace file viewer ([#1651](https://github.com/intent-hq/cloudlands-fe/issues/1651)) ([ddbcb42](https://github.com/intent-hq/cloudlands-fe/commit/ddbcb427ec67e8f24c4757c3d765930532ded650))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.52 ([#1657](https://github.com/intent-hq/cloudlands-fe/issues/1657)) ([0bc1b23](https://github.com/intent-hq/cloudlands-fe/commit/0bc1b2303f493f65c4e03b82e6794ea0c9c88e7b))
* specialist surfaces honor the daemon set in replacement mode ([#1646](https://github.com/intent-hq/cloudlands-fe/issues/1646)) ([dc10b78](https://github.com/intent-hq/cloudlands-fe/commit/dc10b787d16a10efcfe7ecffdafc8260d24c97be))
* stop treating markdown blockquote lines as CLI commands in messageParser ([#1652](https://github.com/intent-hq/cloudlands-fe/issues/1652)) ([eb4002f](https://github.com/intent-hq/cloudlands-fe/commit/eb4002fb07fef86a524ac75daaa9c7037dc52f73))

## [2.87.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.87.0...v2.87.1) (2026-08-24)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.51 ([#1647](https://github.com/intent-hq/cloudlands-fe/issues/1647)) ([6332ea8](https://github.com/intent-hq/cloudlands-fe/commit/6332ea874623b60e30bf9fa14f9e29fbc4976eba))

## [2.87.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.5...v2.87.0) (2026-08-24)


### 🚀 Features

* run task uses the specialists.default daemon setting ([#1640](https://github.com/intent-hq/cloudlands-fe/issues/1640)) ([591f0c0](https://github.com/intent-hq/cloudlands-fe/commit/591f0c0f227842379a0c929e08344226d2326e7a))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.49 ([#1643](https://github.com/intent-hq/cloudlands-fe/issues/1643)) ([6eb89b1](https://github.com/intent-hq/cloudlands-fe/commit/6eb89b1da29fa0809fbbc376f77676208b257bdb))
* bump intentd sidecar to v0.7.50 ([#1645](https://github.com/intent-hq/cloudlands-fe/issues/1645)) ([5e6b2dc](https://github.com/intent-hq/cloudlands-fe/commit/5e6b2dc5d2fecaa73a2d5686e68cb060a8124345))
* close only the lightbox when clicking its backdrop above a modal dialog ([#1639](https://github.com/intent-hq/cloudlands-fe/issues/1639)) ([7d00722](https://github.com/intent-hq/cloudlands-fe/commit/7d0072274d46045fe4d67a207c51ec0a1aa30657))
* require double tildes for strikethrough in marked pipelines ([#1641](https://github.com/intent-hq/cloudlands-fe/issues/1641)) ([803aced](https://github.com/intent-hq/cloudlands-fe/commit/803aced8c8b18e3ec75fca02aff6865551060888))

## [2.86.5](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.4...v2.86.5) (2026-08-24)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.48 ([#1637](https://github.com/intent-hq/cloudlands-fe/issues/1637)) ([2d09a23](https://github.com/intent-hq/cloudlands-fe/commit/2d09a2378854a59747598cb9fab1f1c554b3fc88))

## [2.86.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.3...v2.86.4) (2026-08-24)


### 🐛 Bug Fixes

* replace heuristic chat sweep-sparing with interest leases to end the stranded-window family ([#1635](https://github.com/intent-hq/cloudlands-fe/issues/1635)) ([650fb8e](https://github.com/intent-hq/cloudlands-fe/commit/650fb8e9cb239afee88c2e2c361a5920d7d40f7a))

## [2.86.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.2...v2.86.3) (2026-08-23)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.47 ([#1634](https://github.com/intent-hq/cloudlands-fe/issues/1634)) ([495c7a3](https://github.com/intent-hq/cloudlands-fe/commit/495c7a31178b56d91475925c6cb656423f8aff1e))
* make ModelPicker trigger-label lookup prefix-insensitive ([#1631](https://github.com/intent-hq/cloudlands-fe/issues/1631)) ([337539b](https://github.com/intent-hq/cloudlands-fe/commit/337539b3ed6a729809be009ee36d4a25163ab7c3))

## [2.86.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.1...v2.86.2) (2026-08-23)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.46 ([#1630](https://github.com/intent-hq/cloudlands-fe/issues/1630)) ([d3407f9](https://github.com/intent-hq/cloudlands-fe/commit/d3407f9407c2d805609701665636f617302cb4a3))
* guard ChiefCard against null activeThread agentId access ([#1628](https://github.com/intent-hq/cloudlands-fe/issues/1628)) ([0f4b4bc](https://github.com/intent-hq/cloudlands-fe/commit/0f4b4bc4c09d6653c12388c233c9f72a1eadb4a8))
* only flag the truly last block of a streaming message as streaming ([#1624](https://github.com/intent-hq/cloudlands-fe/issues/1624)) ([53fabae](https://github.com/intent-hq/cloudlands-fe/commit/53fabaeadddb3614bd6dc12ae008a263f1b67d8a))
* remove chief user-row band and let aurora reach window edges ([#1626](https://github.com/intent-hq/cloudlands-fe/issues/1626)) ([1279281](https://github.com/intent-hq/cloudlands-fe/commit/1279281879de5dffec7f12ffacdad91052957a65))

## [2.86.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.86.0...v2.86.1) (2026-08-23)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.44 ([#1625](https://github.com/intent-hq/cloudlands-fe/issues/1625)) ([dae4ea7](https://github.com/intent-hq/cloudlands-fe/commit/dae4ea7f4d1e2f15b651102efc12a06f22d9cf89))
* bump intentd sidecar to v0.7.45 ([#1627](https://github.com/intent-hq/cloudlands-fe/issues/1627)) ([eb0370f](https://github.com/intent-hq/cloudlands-fe/commit/eb0370f3445a82c44f24847f3340e35876aa1de8))
* never render a default pseudo-row in the model picker list ([#1620](https://github.com/intent-hq/cloudlands-fe/issues/1620)) ([aa42328](https://github.com/intent-hq/cloudlands-fe/commit/aa4232828a73d1129214a15c7706a60a02aefef2))
* scope STAB-9 event-driven agent refresh to the changed agent ([#1619](https://github.com/intent-hq/cloudlands-fe/issues/1619)) ([dc32b0b](https://github.com/intent-hq/cloudlands-fe/commit/dc32b0b0e5764d354d8223081977598af221d482))
* stop rendering 'No results' above real search output and parse grep-style results ([#1623](https://github.com/intent-hq/cloudlands-fe/issues/1623)) ([522894e](https://github.com/intent-hq/cloudlands-fe/commit/522894eeadb92385f435f25ed4eadb2755fa7299))

## [2.86.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.85.1...v2.86.0) (2026-08-23)


### 🚀 Features

* **hud:** diagonal shimmer on in-progress takeover cells ([#1615](https://github.com/intent-hq/cloudlands-fe/issues/1615)) ([f3b100d](https://github.com/intent-hq/cloudlands-fe/commit/f3b100d599f4443dfc9dc58d0ea56f9050339904))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.43 ([#1621](https://github.com/intent-hq/cloudlands-fe/issues/1621)) ([277590e](https://github.com/intent-hq/cloudlands-fe/commit/277590e2e3815680d8d1411bcbcdf83f9640af51))

## [2.85.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.85.0...v2.85.1) (2026-08-23)


### 🐛 Bug Fixes

* revert fallback plan card for providers without ACP plans ([#1611](https://github.com/intent-hq/cloudlands-fe/issues/1611)) ([#1616](https://github.com/intent-hq/cloudlands-fe/issues/1616)) ([8fdea00](https://github.com/intent-hq/cloudlands-fe/commit/8fdea00a980a062c481e814300cdab1023c7bc51))

## [2.85.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.84.1...v2.85.0) (2026-08-23)


### 🚀 Features

* show workspace tasks when a provider emits no ACP plan ([#1611](https://github.com/intent-hq/cloudlands-fe/issues/1611)) ([778b32b](https://github.com/intent-hq/cloudlands-fe/commit/778b32b502ad46ffbc46906b75f5bd44e394b508))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.42 ([#1614](https://github.com/intent-hq/cloudlands-fe/issues/1614)) ([bf97a69](https://github.com/intent-hq/cloudlands-fe/commit/bf97a69b45df7092943666e047b11daf9910f147))

## [2.84.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.84.0...v2.84.1) (2026-08-23)


### 🐛 Bug Fixes

* bootstrap the renderer store for Playwright CT and repair TaskItemNodeView specs ([#1609](https://github.com/intent-hq/cloudlands-fe/issues/1609)) ([c1d0e82](https://github.com/intent-hq/cloudlands-fe/commit/c1d0e82b56a77dcffe699d35b8ecddc9b8474343))
* bump intentd sidecar to v0.7.41 ([#1612](https://github.com/intent-hq/cloudlands-fe/issues/1612)) ([3b46ebe](https://github.com/intent-hq/cloudlands-fe/commit/3b46ebe61ecd5ee3c5a78849751ab0a605976d44))

## [2.84.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.83.0...v2.84.0) (2026-08-23)


### 🚀 Features

* replace app brand mark with burst logo ([#1605](https://github.com/intent-hq/cloudlands-fe/issues/1605)) ([98dee7e](https://github.com/intent-hq/cloudlands-fe/commit/98dee7e4b25bcffd4355ab22b9b6228ccabc8130))

## [2.83.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.82.0...v2.83.0) (2026-08-22)


### 🚀 Features

* chat user-message navigator full-history coverage ([#1602](https://github.com/intent-hq/cloudlands-fe/issues/1602)) ([d78177d](https://github.com/intent-hq/cloudlands-fe/commit/d78177d6c136b0d68de9c82a5527830eba82b1bf))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.40 ([#1606](https://github.com/intent-hq/cloudlands-fe/issues/1606)) ([579306d](https://github.com/intent-hq/cloudlands-fe/commit/579306ddb503852eec0578cd69a7d2b721706a48))

## [2.82.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.81.0...v2.82.0) (2026-08-22)


### 🚀 Features

* delegate MCP connection test to daemon mcp.testConnection RPC ([#1599](https://github.com/intent-hq/cloudlands-fe/issues/1599)) ([24f5b49](https://github.com/intent-hq/cloudlands-fe/commit/24f5b492a7450069f1ece85d74e76196d6f8f982))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.39 ([#1603](https://github.com/intent-hq/cloudlands-fe/issues/1603)) ([d1e8836](https://github.com/intent-hq/cloudlands-fe/commit/d1e88365bb816ef0e30e19d8826194ada4367374))
* focus InterruptedAgentsModal on open so Escape dismisses immediately ([#1596](https://github.com/intent-hq/cloudlands-fe/issues/1596)) ([e3762ce](https://github.com/intent-hq/cloudlands-fe/commit/e3762ceca3a73d823bab1e31dfa8e5114bc27815))
* keep Update Ready toast persistent (manual check resets dismiss cooldown; only explicit dismissals arm it) ([#1600](https://github.com/intent-hq/cloudlands-fe/issues/1600)) ([60e85b3](https://github.com/intent-hq/cloudlands-fe/commit/60e85b3b08f326ea9119ac0038346e3f7eb4c61b))
* panel actions menu cropped and Copy conversation stuck disabled ([#1598](https://github.com/intent-hq/cloudlands-fe/issues/1598)) ([a356d29](https://github.com/intent-hq/cloudlands-fe/commit/a356d29321fbeac7b9e524d782921dd39bbd8d94))

## [2.81.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.80.1...v2.81.0) (2026-08-22)


### 🚀 Features

* default agentFeatures.taskGraph on and drop off-by-default wording ([#1591](https://github.com/intent-hq/cloudlands-fe/issues/1591)) ([da06f85](https://github.com/intent-hq/cloudlands-fe/commit/da06f857056262baa0320d0305f44185c2a28cdd))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.38 ([#1597](https://github.com/intent-hq/cloudlands-fe/issues/1597)) ([7ac27f1](https://github.com/intent-hq/cloudlands-fe/commit/7ac27f18670e16ff62fec654ac8778edc3d1c75b))
* **i18n:** use Taiwan-conventional 新增 for zh-TW "New X" action labels ([#1590](https://github.com/intent-hq/cloudlands-fe/issues/1590)) ([64867b9](https://github.com/intent-hq/cloudlands-fe/commit/64867b9531dfab538073836c36a5c530a0cd81b4))

## [2.80.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.80.0...v2.80.1) (2026-08-22)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.37 ([#1592](https://github.com/intent-hq/cloudlands-fe/issues/1592)) ([1749ccb](https://github.com/intent-hq/cloudlands-fe/commit/1749ccbd8ecc2ee7a1df1654c4382ea72ef06851))

## [2.80.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.79.2...v2.80.0) (2026-08-22)


### 🚀 Features

* **ci:** add beta-first guard to release-stable workflow ([#1584](https://github.com/intent-hq/cloudlands-fe/issues/1584)) ([ff634e7](https://github.com/intent-hq/cloudlands-fe/commit/ff634e79f54b1a3c11196f48dcb47695f8d8056a))
* group legacy Auggie models ([#1489](https://github.com/intent-hq/cloudlands-fe/issues/1489)) ([8c6dd52](https://github.com/intent-hq/cloudlands-fe/commit/8c6dd526dd1eb0659d9d3574d6d7d57cfab21131))
* replace native quit dialog with in-app quit confirmation modal ([#1588](https://github.com/intent-hq/cloudlands-fe/issues/1588)) ([f4f8ca9](https://github.com/intent-hq/cloudlands-fe/commit/f4f8ca9b32148bc763a7d0eb5cc9ae29c5be94fc))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.36 ([#1589](https://github.com/intent-hq/cloudlands-fe/issues/1589)) ([de7d9b0](https://github.com/intent-hq/cloudlands-fe/commit/de7d9b0ae7e5320d7b892fb481899547e107fe4f))
* color merged PR workspace status purple ([#1587](https://github.com/intent-hq/cloudlands-fe/issues/1587)) ([83bdac8](https://github.com/intent-hq/cloudlands-fe/commit/83bdac8b96f0b705a9d1b85995a8202663839cf8))
* hide irrelevant reasoning footer ([#1490](https://github.com/intent-hq/cloudlands-fe/issues/1490)) ([fa03cfe](https://github.com/intent-hq/cloudlands-fe/commit/fa03cfe2a3d056b03bcd7ee8805b94446893aaec))
* open attachment lightbox with full-res image despite throttled selector lag ([#1585](https://github.com/intent-hq/cloudlands-fe/issues/1585)) ([7c7e9b4](https://github.com/intent-hq/cloudlands-fe/commit/7c7e9b4cefe84ccf26bf38cf2cbdbcca74a61ebd))
* prevent answered questions from reappearing ([#1526](https://github.com/intent-hq/cloudlands-fe/issues/1526)) ([c2de1a2](https://github.com/intent-hq/cloudlands-fe/commit/c2de1a28ee8f5fc316f3c8429d4c6107cb7ffb55))
* re-register webview for CDP after a panel drag recreates the guest ([#1581](https://github.com/intent-hq/cloudlands-fe/issues/1581)) ([afdc69d](https://github.com/intent-hq/cloudlands-fe/commit/afdc69d7efe72fa9f2bd90333a4c9f3e438944e1))
* reconcile status after failed staging ([#1491](https://github.com/intent-hq/cloudlands-fe/issues/1491)) ([46e212a](https://github.com/intent-hq/cloudlands-fe/commit/46e212a9d0d8397e641ced4d4fcf170f710ffa98))
* spare hosted still-acquiring warm reopens from subscription sweeps ([#1586](https://github.com/intent-hq/cloudlands-fe/issues/1586)) ([db0a552](https://github.com/intent-hq/cloudlands-fe/commit/db0a5522e4da906e4d7bbaf893d165ff5863c6d3))

## [2.79.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.79.1...v2.79.2) (2026-08-22)


### 🐛 Bug Fixes

* make sidebar hidden browser-tab rows whole-row clickable ([#1580](https://github.com/intent-hq/cloudlands-fe/issues/1580)) ([65ee55f](https://github.com/intent-hq/cloudlands-fe/commit/65ee55f63d1e829a06de3817291cc4ffe631c07d))

## [2.79.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.79.0...v2.79.1) (2026-08-22)


### 🐛 Bug Fixes

* bound screenshot Page-domain CDP calls and fall back to capturePage ([#1578](https://github.com/intent-hq/cloudlands-fe/issues/1578)) ([0f9d130](https://github.com/intent-hq/cloudlands-fe/commit/0f9d1303d6a5025b5911fa96ad9a71cd806d7c6d))
* prevent broken-pipe logging loops ([#1573](https://github.com/intent-hq/cloudlands-fe/issues/1573)) ([e3cb8dd](https://github.com/intent-hq/cloudlands-fe/commit/e3cb8ddc557aa9d95255fc5fa82f4167a7aeca56))

## [2.79.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.78.2...v2.79.0) (2026-08-22)


### 🚀 Features

* add fixed workspace panel columns ([#1529](https://github.com/intent-hq/cloudlands-fe/issues/1529)) ([ba53c57](https://github.com/intent-hq/cloudlands-fe/commit/ba53c57507f9c005b832f4b3ce870447505a5b9b))
* use unstable development icon ([#1488](https://github.com/intent-hq/cloudlands-fe/issues/1488)) ([5da886e](https://github.com/intent-hq/cloudlands-fe/commit/5da886e637f70c3a59ed281b595c61dae6f0e61f))


### 🐛 Bug Fixes

* prevent suggested prompt stream flashes ([#1390](https://github.com/intent-hq/cloudlands-fe/issues/1390)) ([a20ca4b](https://github.com/intent-hq/cloudlands-fe/commit/a20ca4b7f6d7d1b89386f999b51c781b5087ed0c))

## [2.78.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.78.1...v2.78.2) (2026-08-22)


### 🐛 Bug Fixes

* ignore nested .intent worktrees in the dev-server watcher ([#1575](https://github.com/intent-hq/cloudlands-fe/issues/1575)) ([d46698f](https://github.com/intent-hq/cloudlands-fe/commit/d46698f99515824187abac278c9282aa45eca3b8))

## [2.78.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.78.0...v2.78.1) (2026-08-21)


### 🐛 Bug Fixes

* avoid pre-pull for isolated workspaces ([#1569](https://github.com/intent-hq/cloudlands-fe/issues/1569)) ([994b16c](https://github.com/intent-hq/cloudlands-fe/commit/994b16cbb60da70eff24d2f2206f72793652e6bd))

## [2.78.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.77.3...v2.78.0) (2026-08-21)


### 🚀 Features

* add privacy-safe stream lifecycle telemetry ([#1528](https://github.com/intent-hq/cloudlands-fe/issues/1528)) ([2661368](https://github.com/intent-hq/cloudlands-fe/commit/26613686adaa61ee68802551fd45707415dddf4b))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.34 ([#1570](https://github.com/intent-hq/cloudlands-fe/issues/1570)) ([75be906](https://github.com/intent-hq/cloudlands-fe/commit/75be9063eed593cbb2b94131c1e0d3211e6c7515))

## [2.77.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.77.2...v2.77.3) (2026-08-21)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.32 ([#1566](https://github.com/intent-hq/cloudlands-fe/issues/1566)) ([a2c5ec1](https://github.com/intent-hq/cloudlands-fe/commit/a2c5ec1533de07c39d2237e1ae665ebef38567f0))
* bump intentd sidecar to v0.7.33 ([#1567](https://github.com/intent-hq/cloudlands-fe/issues/1567)) ([12e2ec9](https://github.com/intent-hq/cloudlands-fe/commit/12e2ec9f39a1482e396907aea632f6a654ad4acb))
* protect revealed agent tabs from pin-mode reusable-panel invariant re-hide ([#1564](https://github.com/intent-hq/cloudlands-fe/issues/1564)) ([45e8c91](https://github.com/intent-hq/cloudlands-fe/commit/45e8c917e69f5af32d7c56718fa488fe266b5b1d))
* **release:** stop idempotent re-promotion from clobbering aggregated channel notes ([#1565](https://github.com/intent-hq/cloudlands-fe/issues/1565)) ([be08276](https://github.com/intent-hq/cloudlands-fe/commit/be082768aed723ec38d2478c792025321165212e))
* wrap sidebar View PR chip label instead of truncating ([#1562](https://github.com/intent-hq/cloudlands-fe/issues/1562)) ([341aa72](https://github.com/intent-hq/cloudlands-fe/commit/341aa725da67ea20eea671f40ad115d51c0c484e))


### ⚡ Performance

* cut workspace-switch reveal latency to ~wire latency ([#1558](https://github.com/intent-hq/cloudlands-fe/issues/1558)) ([3b2ce1d](https://github.com/intent-hq/cloudlands-fe/commit/3b2ce1d4e67a243d984ace43c5c37c1192bf9ae3))

## [2.77.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.77.1...v2.77.2) (2026-08-21)


### 🐛 Bug Fixes

* anchor trigger-less provider path panel on-screen ([#1557](https://github.com/intent-hq/cloudlands-fe/issues/1557)) ([46211a3](https://github.com/intent-hq/cloudlands-fe/commit/46211a34ecf2841372d33e81df550153317b2a84))
* make showTab reveal user-visible and stop revealed tabs reverting to hidden ([#1560](https://github.com/intent-hq/cloudlands-fe/issues/1560)) ([2b7c857](https://github.com/intent-hq/cloudlands-fe/commit/2b7c85741c0bdb898bcc506973b7d91986474a8f))

## [2.77.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.77.0...v2.77.1) (2026-08-21)


### 🐛 Bug Fixes

* align hidden sidebar tab rows with visible ones ([#1554](https://github.com/intent-hq/cloudlands-fe/issues/1554)) ([b2252f9](https://github.com/intent-hq/cloudlands-fe/commit/b2252f9782027875e2d6ab54e2e5722a873f9596))
* bump intentd sidecar to v0.7.31 ([#1559](https://github.com/intent-hq/cloudlands-fe/issues/1559)) ([13370ee](https://github.com/intent-hq/cloudlands-fe/commit/13370ee1ae68610efe7da9e42025d11d6c31ea82))
* sidebar hidden-tab reveal avoids the conversation's panel ([#1555](https://github.com/intent-hq/cloudlands-fe/issues/1555)) ([635c68b](https://github.com/intent-hq/cloudlands-fe/commit/635c68bfc85ff7688c7a40c90386dd0f4e5ad1c3))

## [2.77.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.76.0...v2.77.0) (2026-08-21)


### 🚀 Features

* add collapsible Browser tabs section to the agent conversation footer ([#1545](https://github.com/intent-hq/cloudlands-fe/issues/1545)) ([56fbed9](https://github.com/intent-hq/cloudlands-fe/commit/56fbed98632ff66c9f6f3bbc1e7eb31ce912c38a))
* compact icon-only agent owner chip in browser toolbar ([#1544](https://github.com/intent-hq/cloudlands-fe/issues/1544)) ([5916ebf](https://github.com/intent-hq/cloudlands-fe/commit/5916ebf78268b1a5a47cf24f60c6c493dcc48585))
* onboarding prompt-step picker commits provider + default model at create-submit ([#1536](https://github.com/intent-hq/cloudlands-fe/issues/1536)) ([ccc4348](https://github.com/intent-hq/cloudlands-fe/commit/ccc43484ce69559684038fc69ed2d564befbe46a))
* show PR status icon and repo/number/title chip on the sidebar View PR action ([#1547](https://github.com/intent-hq/cloudlands-fe/issues/1547)) ([af51013](https://github.com/intent-hq/cloudlands-fe/commit/af51013ca2f02d5b33a465dbdded6137dfe932a8))
* showTab action, listTabs visibility field, focusTab hidden guard ([#1534](https://github.com/intent-hq/cloudlands-fe/issues/1534)) ([d2900b3](https://github.com/intent-hq/cloudlands-fe/commit/d2900b3d93c68938d1b86542e0a62eeb8a3ce9bf))
* **store:** configure Themis Redux action logging ([#1524](https://github.com/intent-hq/cloudlands-fe/issues/1524)) ([6c882a7](https://github.com/intent-hq/cloudlands-fe/commit/6c882a7e5a8fbef996b900b513a3ca8c5af88ffe))
* **ui:** dim archived workspace tab titles in the tab strip ([#1543](https://github.com/intent-hq/cloudlands-fe/issues/1543)) ([8037586](https://github.com/intent-hq/cloudlands-fe/commit/8037586517089b7fb8dc30c92d1d9070bad297ef))
* **ui:** route workspace-list PR pill clicks through the GitHub link menu ([#1546](https://github.com/intent-hq/cloudlands-fe/issues/1546)) ([dbb9c76](https://github.com/intent-hq/cloudlands-fe/commit/dbb9c768615101534f01cc1912a35a34913027b3))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.28 ([#1548](https://github.com/intent-hq/cloudlands-fe/issues/1548)) ([17dbc91](https://github.com/intent-hq/cloudlands-fe/commit/17dbc9185a5b801250d25bd6783a1ec1a2e47312))
* bump intentd sidecar to v0.7.29 ([#1553](https://github.com/intent-hq/cloudlands-fe/issues/1553)) ([63fea0d](https://github.com/intent-hq/cloudlands-fe/commit/63fea0d52c063bff6d735a05c9e5f772ad70323f))
* **chat:** spare still-acquiring cold opens from the viewed-agent swap sweep ([#1542](https://github.com/intent-hq/cloudlands-fe/issues/1542)) ([732366a](https://github.com/intent-hq/cloudlands-fe/commit/732366afed57a046be9d5fe4fc136fcff5f56b2c))
* clear stale busy indicators when an agent process is evicted ([#1531](https://github.com/intent-hq/cloudlands-fe/issues/1531)) ([189f9ee](https://github.com/intent-hq/cloudlands-fe/commit/189f9eebe9e0842325d7ae33c618b567415df2ac))
* keep workspace-card task progress bar mounted across refetches ([#1539](https://github.com/intent-hq/cloudlands-fe/issues/1539)) ([5a9c38f](https://github.com/intent-hq/cloudlands-fe/commit/5a9c38f63f93f1fdc5f9dd7c568e541cf9df918e))
* restore tabbed model picker refresh ([#1551](https://github.com/intent-hq/cloudlands-fe/issues/1551)) ([9837df6](https://github.com/intent-hq/cloudlands-fe/commit/9837df65dc3e795f016f060b6bcdbda264d3e9eb))
* run startup release-notes check regardless of window existence ([#1533](https://github.com/intent-hq/cloudlands-fe/issues/1533)) ([892b996](https://github.com/intent-hq/cloudlands-fe/commit/892b996e2aec362770cb9c9f8dc061e7e4922635))
* **ui:** unify custom toast close buttons and remove dead NotificationNavigateToast ([#1538](https://github.com/intent-hq/cloudlands-fe/issues/1538)) ([fc48488](https://github.com/intent-hq/cloudlands-fe/commit/fc48488de1b97054eb72bb0cce6b897f1fa198f8))

## [2.76.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.75.1...v2.76.0) (2026-08-21)


### 🚀 Features

* agent openTab creates hidden tabs by default ([#1530](https://github.com/intent-hq/cloudlands-fe/issues/1530)) ([51d9dcd](https://github.com/intent-hq/cloudlands-fe/commit/51d9dcde4588769ec713ba7e4660bfe10bfafca1))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.27 ([#1540](https://github.com/intent-hq/cloudlands-fe/issues/1540)) ([282ac20](https://github.com/intent-hq/cloudlands-fe/commit/282ac20778aeb241553ddd0f85dc15a98dad863d))
* never blur/redirect overlay-hosted focus on panel reveal ([#1532](https://github.com/intent-hq/cloudlands-fe/issues/1532)) ([7b02d05](https://github.com/intent-hq/cloudlands-fe/commit/7b02d05125ca959e410aace4c2298ada46e9d407))

## [2.75.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.75.0...v2.75.1) (2026-08-20)


### 🐛 Bug Fixes

* keep panel file-drop handler identity stable for unregister ([#1523](https://github.com/intent-hq/cloudlands-fe/issues/1523)) ([dd0edfb](https://github.com/intent-hq/cloudlands-fe/commit/dd0edfb39b09f745745d5a5cbff7c74f8cd99c47))

## [2.75.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.74.0...v2.75.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* /

### 🚀 Features

* **browser:** owned-tab lifecycle — always-active webviews, hide on user close, destroy on agent deletion ([#1467](https://github.com/intent-hq/cloudlands-fe/issues/1467)) ([f8ded80](https://github.com/intent-hq/cloudlands-fe/commit/f8ded803043ac3a219c16a04c3714ba8b898cebd))
* **browser:** ownership UI — sidebar owner groups + header agent chip ([#1518](https://github.com/intent-hq/cloudlands-fe/issues/1518)) ([343a1fd](https://github.com/intent-hq/cloudlands-fe/commit/343a1fd0cc73f6f8d5c82de35fd1251660561011))
* compact gap between batched user messages sharing queueInfo.batchId ([#1498](https://github.com/intent-hq/cloudlands-fe/issues/1498)) ([4797eb7](https://github.com/intent-hq/cloudlands-fe/commit/4797eb7c0a5a821ba8aa78b3c5eed255aa06fad0))
* listTabs ownership scope + owner display info + sizing ([#1456](https://github.com/intent-hq/cloudlands-fe/issues/1456)) ([cb67aa7](https://github.com/intent-hq/cloudlands-fe/commit/cb67aa743921cc42ae3b390afa7aca4d30148067))
* persist owned-tab emulatedSize across relaunch ([#1517](https://github.com/intent-hq/cloudlands-fe/issues/1517)) ([20b6598](https://github.com/intent-hq/cloudlands-fe/commit/20b6598abccb92ce408749e5aeefba6e6dcfc80b))
* remove READ-ONLY pill from secondary git root changes view ([#1514](https://github.com/intent-hq/cloudlands-fe/issues/1514)) ([622cbc1](https://github.com/intent-hq/cloudlands-fe/commit/622cbc173b0ae3522527da7bc7515f87ffe175c5))
* restore HUD window on backend switch and persist grid filters per backend ([#1521](https://github.com/intent-hq/cloudlands-fe/issues/1521)) ([aa22077](https://github.com/intent-hq/cloudlands-fe/commit/aa22077e8b4830675ca840834760958f59a9a487))


### 🐛 Bug Fixes

* **browser:** bridge browser:list-tabs-response to the real preload bridge so agent listTabs works in the packaged app ([#1486](https://github.com/intent-hq/cloudlands-fe/issues/1486)) ([c6eded9](https://github.com/intent-hq/cloudlands-fe/commit/c6eded93d471fc864b073944fb05851bf9ed9403))
* bump intentd sidecar to v0.7.23 ([#1512](https://github.com/intent-hq/cloudlands-fe/issues/1512)) ([54c0da1](https://github.com/intent-hq/cloudlands-fe/commit/54c0da1e16eb7693861624e8bc3da178916adf4a))
* bump intentd sidecar to v0.7.24 ([#1522](https://github.com/intent-hq/cloudlands-fe/issues/1522)) ([f1c35b8](https://github.com/intent-hq/cloudlands-fe/commit/f1c35b80e500a206b31c9877ebb72ebb88e4b8fb))
* bump intentd sidecar to v0.7.25 ([#1525](https://github.com/intent-hq/cloudlands-fe/issues/1525)) ([2ec02af](https://github.com/intent-hq/cloudlands-fe/commit/2ec02af8fa54e30cf013c86f61689f4677bfad59))
* **chat:** link/mention parsing and full-res image lightbox fixes ([#1520](https://github.com/intent-hq/cloudlands-fe/issues/1520)) ([e261b3c](https://github.com/intent-hq/cloudlands-fe/commit/e261b3ce03590d781a59f19fa9c5acb279e77d8b))
* clip horizontal overflow from queued-messages full-bleed divider ([#1508](https://github.com/intent-hq/cloudlands-fe/issues/1508)) ([1cc62ad](https://github.com/intent-hq/cloudlands-fe/commit/1cc62adcb63fd81a4fe60dbdf0d4b3042693e1c8))
* never land chat at top on workspace re-entry; divider entry at 20% viewport ([#1476](https://github.com/intent-hq/cloudlands-fe/issues/1476)) ([0863481](https://github.com/intent-hq/cloudlands-fe/commit/08634815439c79d4b3466ddafe1653b46821b0f8))
* preserve daemon-merged pullRequests pool on non-authoritative upserts ([#1509](https://github.com/intent-hq/cloudlands-fe/issues/1509)) ([72232b8](https://github.com/intent-hq/cloudlands-fe/commit/72232b8b57e5f3a12355a01efdbf43eb10eeab67))
* spare in-flight sibling hydrations from the viewed-agent swap sweep ([#1485](https://github.com/intent-hq/cloudlands-fe/issues/1485)) ([a79ac8f](https://github.com/intent-hq/cloudlands-fe/commit/a79ac8fbc2a37067f429f6371202fbbccfaa0bb6))
* **window:** bridge set-title, set-browser-focused, and app:get-version to main process ([#1487](https://github.com/intent-hq/cloudlands-fe/issues/1487)) ([d7043ff](https://github.com/intent-hq/cloudlands-fe/commit/d7043ff5382cbbf91488807c39a6e503fc02813a))


### ⚙️ Miscellaneous Tasks

* event-chain auto-cut on all release-worthy pushes with a 60-min throttle ([#1505](https://github.com/intent-hq/cloudlands-fe/issues/1505)) ([d8c3eac](https://github.com/intent-hq/cloudlands-fe/commit/d8c3eacd2e636bf5c358d90fc01670ddfcb7213c))
* steer release line back to 2.x after false major bump ([#1515](https://github.com/intent-hq/cloudlands-fe/issues/1515)) ([1bb0730](https://github.com/intent-hq/cloudlands-fe/commit/1bb0730973f0ccd7cfd7da908a30ed63d5836578))

## [2.74.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.73.1...v2.74.0) (2026-08-20)


### 🚀 Features

* adopt daemon-merged pullRequests in workspace-card PR badge ([#1500](https://github.com/intent-hq/cloudlands-fe/issues/1500)) ([242bce5](https://github.com/intent-hq/cloudlands-fe/commit/242bce59fcf24ac190913a8d85dcb80b751ff835))

## [2.73.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.73.0...v2.73.1) (2026-08-20)


### 🐛 Bug Fixes

* stop panel reveal from stealing focus inside the revealed panel ([#1502](https://github.com/intent-hq/cloudlands-fe/issues/1502)) ([568f265](https://github.com/intent-hq/cloudlands-fe/commit/568f26568c64aacb29d7f71f0a9839ea038b9b35))

## [2.73.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.72.0...v2.73.0) (2026-08-20)


### 🚀 Features

* show remote daemon hostname in HUD footer system zone ([#1481](https://github.com/intent-hq/cloudlands-fe/issues/1481)) ([ce0c3e9](https://github.com/intent-hq/cloudlands-fe/commit/ce0c3e9e7e16ccffd25d9ba877e4a18c31e8f97a))


### 🐛 Bug Fixes

* rename sidebar status group Complete to Completed ([#1479](https://github.com/intent-hq/cloudlands-fe/issues/1479)) ([6068202](https://github.com/intent-hq/cloudlands-fe/commit/60682026a1b6d12d608c3089decca2e93770e260))

## [2.72.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.71.0...v2.72.0) (2026-08-20)


### 🚀 Features

* keep checking for updates while one is downloaded and auto-supersede ([#1482](https://github.com/intent-hq/cloudlands-fe/issues/1482)) ([8fdf46f](https://github.com/intent-hq/cloudlands-fe/commit/8fdf46f184147346d1cff3d9d279faad54521fe8))
* reconcile hydrated workspace tabs against the loaded workspace list ([#1471](https://github.com/intent-hq/cloudlands-fe/issues/1471)) ([b89b62a](https://github.com/intent-hq/cloudlands-fe/commit/b89b62a50b206ba60e0ede774d614443305b66fc))

## [2.71.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.70.0...v2.71.0) (2026-08-19)


### 🚀 Features

* agent viewport sizing — resizeTab, openTab width/height, scale-to-fit ([#1458](https://github.com/intent-hq/cloudlands-fe/issues/1458)) ([d436ba6](https://github.com/intent-hq/cloudlands-fe/commit/d436ba6c69a2b6059b599ee0ed146cecc8b0c06d))


### 🐛 Bug Fixes

* localize Shell tab label for zh locales and setup-script display name ([#1472](https://github.com/intent-hq/cloudlands-fe/issues/1472)) ([5e93868](https://github.com/intent-hq/cloudlands-fe/commit/5e9386863d426f974148bd964f94e769c4952559))
* stop the chat-export path clobbering the main-process locale ([#1475](https://github.com/intent-hq/cloudlands-fe/issues/1475)) ([c9d0138](https://github.com/intent-hq/cloudlands-fe/commit/c9d01382e9b5bdcf5d54a5376dc41137e5c68b55))

## [2.70.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.69.0...v2.70.0) (2026-08-19)


### 🚀 Features

* extend release fast path to intentd.version pin bumps ([#1473](https://github.com/intent-hq/cloudlands-fe/issues/1473)) ([94cef84](https://github.com/intent-hq/cloudlands-fe/commit/94cef84c287905e08eaf10eb35456f65c89adfbe))


### 🐛 Bug Fixes

* **panel:** never blur focus inside the panel being revealed ([#1464](https://github.com/intent-hq/cloudlands-fe/issues/1464)) ([4921c3a](https://github.com/intent-hq/cloudlands-fe/commit/4921c3a45e41e60d351358920015a64e9b6b238c))

## [2.69.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.68.0...v2.69.0) (2026-08-19)


### 🚀 Features

* add headless intentd install hint to connect dialog ([#1469](https://github.com/intent-hq/cloudlands-fe/issues/1469)) ([54ab234](https://github.com/intent-hq/cloudlands-fe/commit/54ab23498ee9249cca1605690210de53fa5b63ff))
* infinite scrollback for ChatPanel ([#1453](https://github.com/intent-hq/cloudlands-fe/issues/1453)) ([0067dd2](https://github.com/intent-hq/cloudlands-fe/commit/0067dd2cd32b316682921a11a1ff9f492bc4864a))
* show full-path tooltip on recent local repo hover ([#1468](https://github.com/intent-hq/cloudlands-fe/issues/1468)) ([22b2972](https://github.com/intent-hq/cloudlands-fe/commit/22b2972c0b2875991df26b180b6f8c1e382ba65a))
* update app and development icons ([#1448](https://github.com/intent-hq/cloudlands-fe/issues/1448)) ([6843918](https://github.com/intent-hq/cloudlands-fe/commit/68439188aba07149096bec8554531edaa7f918c0))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.22 ([#1470](https://github.com/intent-hq/cloudlands-fe/issues/1470)) ([b1b6155](https://github.com/intent-hq/cloudlands-fe/commit/b1b615520f0f4baf4594a830326cad55d66818e9))
* center monitored-PR menu item content vertically ([#1466](https://github.com/intent-hq/cloudlands-fe/issues/1466)) ([57dff23](https://github.com/intent-hq/cloudlands-fe/commit/57dff234963e0a0af9a357afc0240f194d326233))
* keep the standing chat subscription alive across a same-agent panel remount ([#1462](https://github.com/intent-hq/cloudlands-fe/issues/1462)) ([111a2f7](https://github.com/intent-hq/cloudlands-fe/commit/111a2f7770b59c15e0ea899a9aa914db4b303351))
* never render raw agent ids in EventWakeupBanner ([#1449](https://github.com/intent-hq/cloudlands-fe/issues/1449)) ([73a20b9](https://github.com/intent-hq/cloudlands-fe/commit/73a20b95008d3a46b49439dc8f44d2fbbbbf901d))

## [2.68.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.67.1...v2.68.0) (2026-08-19)


### 🚀 Features

* persistent tab ownership — ownerAgentId, claimTab, enforcement, per-agent dedupe ([#1450](https://github.com/intent-hq/cloudlands-fe/issues/1450)) ([205b94f](https://github.com/intent-hq/cloudlands-fe/commit/205b94f961935468029feff6047cf52325699445))

## [2.67.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.67.0...v2.67.1) (2026-08-19)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.21 ([#1451](https://github.com/intent-hq/cloudlands-fe/issues/1451)) ([e8aec3b](https://github.com/intent-hq/cloudlands-fe/commit/e8aec3b5f53543bf2cb18da227a23474db160bd6))

## [2.67.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.5...v2.67.0) (2026-08-19)


### 🚀 Features

* polish desktop UI geometry and interactions ([#1373](https://github.com/intent-hq/cloudlands-fe/issues/1373)) ([96e48a0](https://github.com/intent-hq/cloudlands-fe/commit/96e48a0baf89d68a377528c95aa515ebc460378e))


### 🐛 Bug Fixes

* **chat:** hide the workspace setup card during the transcript skeleton state ([#1446](https://github.com/intent-hq/cloudlands-fe/issues/1446)) ([93eeb56](https://github.com/intent-hq/cloudlands-fe/commit/93eeb56e624143757fd09053063aa0056468a62c))

## [2.66.5](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.4...v2.66.5) (2026-08-19)


### 🐛 Bug Fixes

* **agent-preview:** trust the wire preview in TaskAgentStatus and graph-helpers ([#1444](https://github.com/intent-hq/cloudlands-fe/issues/1444)) ([af99090](https://github.com/intent-hq/cloudlands-fe/commit/af990907edd64fdc232a406a9ff378e332cda28e))
* **browser:** detach tunneled-tab rehydration so layout restore settles before listTabs times out ([#1443](https://github.com/intent-hq/cloudlands-fe/issues/1443)) ([caf219f](https://github.com/intent-hq/cloudlands-fe/commit/caf219fe3f97f9ac6defeb36055b1fece3a20be3))
* make the background older-history prepend paint- and scroll-neutral ([#1445](https://github.com/intent-hq/cloudlands-fe/issues/1445)) ([4888a17](https://github.com/intent-hq/cloudlands-fe/commit/4888a1735e974a764b370b2bf4144e4131bef5ce))
* **menu:** always target the app window for the DevTools toggle ([202f44d](https://github.com/intent-hq/cloudlands-fe/commit/202f44d4d7390f2cdde6d466a2150e5482152da0))
* remove leftover console.log('LOAD') debug statement in InlineAgentAvatar ([#1438](https://github.com/intent-hq/cloudlands-fe/issues/1438)) ([7ecadbf](https://github.com/intent-hq/cloudlands-fe/commit/7ecadbff720a90e1fc0bcd05b37ccda9259f817e))
* remove leftover console.log('LOAD') debug statements in AgentPeekCard ([#1440](https://github.com/intent-hq/cloudlands-fe/issues/1440)) ([d241ec0](https://github.com/intent-hq/cloudlands-fe/commit/d241ec02ab1ede0805920bd4320e769dfe9095e2))
* serve wire preview fields verbatim in getAgentPeekData ([#1439](https://github.com/intent-hq/cloudlands-fe/issues/1439)) ([61575ec](https://github.com/intent-hq/cloudlands-fe/commit/61575ec44abb892ca5de5abed663e4a9bbad1d0d))
* trust the push-applied wire preview for live/streaming previews ([#1442](https://github.com/intent-hq/cloudlands-fe/issues/1442)) ([0962792](https://github.com/intent-hq/cloudlands-fe/commit/096279216ddae15acf669f547ca250dbc778655f))

## [2.66.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.3...v2.66.4) (2026-08-18)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.20 ([#1435](https://github.com/intent-hq/cloudlands-fe/issues/1435)) ([6a0c44f](https://github.com/intent-hq/cloudlands-fe/commit/6a0c44ff436e35fe88d38c07e36c311cd0d94f30))

## [2.66.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.2...v2.66.3) (2026-08-18)


### 🐛 Bug Fixes

* default new browser tabs to about:blank ([#1431](https://github.com/intent-hq/cloudlands-fe/issues/1431)) ([f78564e](https://github.com/intent-hq/cloudlands-fe/commit/f78564ee896636864bbe8ad7ea1a38854eb094f4))

## [2.66.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.1...v2.66.2) (2026-08-18)


### 🐛 Bug Fixes

* restore Command-B sidebar toggle in single-workspace layout ([#1430](https://github.com/intent-hq/cloudlands-fe/issues/1430)) ([d77af64](https://github.com/intent-hq/cloudlands-fe/commit/d77af649397f868503ca1f2ad93be2853917e544))

## [2.66.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.66.0...v2.66.1) (2026-08-18)


### 🐛 Bug Fixes

* enforce chat.subscribe sole-writer invariant at stream end ([#1427](https://github.com/intent-hq/cloudlands-fe/issues/1427)) ([45ddc34](https://github.com/intent-hq/cloudlands-fe/commit/45ddc3408522ad720094af9c5bf976d0903542b2))
* persist coordinator specialist assignment ([#1429](https://github.com/intent-hq/cloudlands-fe/issues/1429)) ([d51f4a6](https://github.com/intent-hq/cloudlands-fe/commit/d51f4a6f62674617e34df337e0985dd2b9a6d025))

## [2.66.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.65.0...v2.66.0) (2026-08-18)


### 🚀 Features

* lazy full-block hydration on expand (agent.getMessageBlock, protocol v7.2) ([#1423](https://github.com/intent-hq/cloudlands-fe/issues/1423)) ([1f26658](https://github.com/intent-hq/cloudlands-fe/commit/1f2665831312a57025f6f0b1c316d31daf2c4449))

## [2.65.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.64.2...v2.65.0) (2026-08-18)


### 🚀 Features

* opt into slim conversation projection with 50-message pages ([#1421](https://github.com/intent-hq/cloudlands-fe/issues/1421)) ([f0d852b](https://github.com/intent-hq/cloudlands-fe/commit/f0d852b248ef0c7c7cf86b345632a9cd288ca158))
* rehydrate tunneled browser tabs onto fresh forwards after restart ([#1417](https://github.com/intent-hq/cloudlands-fe/issues/1417)) ([9553bcd](https://github.com/intent-hq/cloudlands-fe/commit/9553bcdf499fc1ee8a11abc0283211bfc1fc2029))


### 🐛 Bug Fixes

* **agent:** dismiss stale agent-failure Retry for deleted agents ([#1414](https://github.com/intent-hq/cloudlands-fe/issues/1414)) ([05ee38c](https://github.com/intent-hq/cloudlands-fe/commit/05ee38c3229b1263a5a116b384bbea197d751cd7))
* **browser:** answer listTabs for the routed workspace missing from layout and tab-strip state ([#1419](https://github.com/intent-hq/cloudlands-fe/issues/1419)) ([98bc3e2](https://github.com/intent-hq/cloudlands-fe/commit/98bc3e29047d89199f7e401cd27d9ad325f6b2ce))
* bump intentd sidecar to v0.7.19 ([#1425](https://github.com/intent-hq/cloudlands-fe/issues/1425)) ([69ab8ee](https://github.com/intent-hq/cloudlands-fe/commit/69ab8eec3cd55daf329551708690f0b3bdcd48ab))
* seed tool blocks only in seedStreamFromSnapshot ([#1422](https://github.com/intent-hq/cloudlands-fe/issues/1422)) ([29c65f8](https://github.com/intent-hq/cloudlands-fe/commit/29c65f86f7fc89213c0683af310de1bbcb3fa7bf))

## [2.64.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.64.1...v2.64.2) (2026-08-18)


### 🐛 Bug Fixes

* merge stream updates by block identity instead of replacing contentBlocks ([#1418](https://github.com/intent-hq/cloudlands-fe/issues/1418)) ([8cac051](https://github.com/intent-hq/cloudlands-fe/commit/8cac051a0e0928a7800f969b9c9a069e3920eb27))

## [2.64.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.64.0...v2.64.1) (2026-08-18)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.18 ([#1415](https://github.com/intent-hq/cloudlands-fe/issues/1415)) ([677e7f5](https://github.com/intent-hq/cloudlands-fe/commit/677e7f5e7fe0adcb134649e5630f422f7d61c365))

## [2.64.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.63.0...v2.64.0) (2026-08-18)


### 🚀 Features

* **browser:** keep background-workspace webviews alive offscreen for content-level ops ([c799f96](https://github.com/intent-hq/cloudlands-fe/commit/c799f96c67bda00e1461aeb259819ef0d3cd5468))

## [2.63.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.62.1...v2.63.0) (2026-08-18)


### 🚀 Features

* **browser:** background-hydrate workspace layout for browser IPC ([#1405](https://github.com/intent-hq/cloudlands-fe/issues/1405)) ([8c3f739](https://github.com/intent-hq/cloudlands-fe/commit/8c3f739b535fe6db403fbc2d34065047eeb34b90))


### 🐛 Bug Fixes

* always scroll to end and lock follow on message send and edit-and-regenerate ([#1409](https://github.com/intent-hq/cloudlands-fe/issues/1409)) ([9e940ca](https://github.com/intent-hq/cloudlands-fe/commit/9e940ca3a1550e99a68c5898439b1d65b1652a19))
* bump intentd sidecar to v0.7.17 ([#1411](https://github.com/intent-hq/cloudlands-fe/issues/1411)) ([35d1caa](https://github.com/intent-hq/cloudlands-fe/commit/35d1caa8732bb87e143bfcb564211aa7ada9fc7d))
* dedupe openTab across tunnel forwards on remote daemons ([#1402](https://github.com/intent-hq/cloudlands-fe/issues/1402)) ([d5825a0](https://github.com/intent-hq/cloudlands-fe/commit/d5825a019a2620c9c248edd3aef531d07aedc3d2))

## [2.62.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.62.0...v2.62.1) (2026-08-18)


### 🐛 Bug Fixes

* sort Changes tab PR sections by most recent update ([#1407](https://github.com/intent-hq/cloudlands-fe/issues/1407)) ([af90b4e](https://github.com/intent-hq/cloudlands-fe/commit/af90b4e7488d683c89b9b19d152dbf0581271708))

## [2.62.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.61.1...v2.62.0) (2026-08-18)


### 🚀 Features

* make running tool calls expandable to show input ([#1404](https://github.com/intent-hq/cloudlands-fe/issues/1404)) ([16d4087](https://github.com/intent-hq/cloudlands-fe/commit/16d4087623b944eab86b348b58cd343bfcb7e028))

## [2.61.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.61.0...v2.61.1) (2026-08-18)


### 🐛 Bug Fixes

* skip automated messages in jump-to-previous chat navigation ([#1401](https://github.com/intent-hq/cloudlands-fe/issues/1401)) ([be0eb8f](https://github.com/intent-hq/cloudlands-fe/commit/be0eb8fa36b91f4ffadc993d905dcdbbb4154415))

## [2.61.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.60.0...v2.61.0) (2026-08-18)


### 🚀 Features

* hydrate per-workspace auto-commit toggle from the daemon ([#1399](https://github.com/intent-hq/cloudlands-fe/issues/1399)) ([18d5427](https://github.com/intent-hq/cloudlands-fe/commit/18d5427a8c500013517092d8b8fca315ec4b17cc))

## [2.60.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.5...v2.60.0) (2026-08-18)


### 🚀 Features

* reveal transcript and utility footer in the same paint ([#1395](https://github.com/intent-hq/cloudlands-fe/issues/1395)) ([32eb5d8](https://github.com/intent-hq/cloudlands-fe/commit/32eb5d85069b439f14c669f6dd27fd43d78860cb))


### 🐛 Bug Fixes

* accept trailing --&gt; closer in suggested-prompts parser ([#1396](https://github.com/intent-hq/cloudlands-fe/issues/1396)) ([b82f30e](https://github.com/intent-hq/cloudlands-fe/commit/b82f30e79e3d08f723d195a5e40d22139f857c71))
* route browser tab actions by workspace and stop masking renderer failures ([#1388](https://github.com/intent-hq/cloudlands-fe/issues/1388)) ([a48e012](https://github.com/intent-hq/cloudlands-fe/commit/a48e012c6f99da6ed6d2cc0c33a82d6527530f89))
* stop per-workspace auto-commit toggle from writing global git.autoCommit ([#1397](https://github.com/intent-hq/cloudlands-fe/issues/1397)) ([9e270e1](https://github.com/intent-hq/cloudlands-fe/commit/9e270e18406cbbc9527da617856e044e93984a7c))

## [2.59.5](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.4...v2.59.5) (2026-08-17)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.16 ([#1393](https://github.com/intent-hq/cloudlands-fe/issues/1393)) ([8fe3fdd](https://github.com/intent-hq/cloudlands-fe/commit/8fe3fdd517e36e0f4352ffc7ac5850e19597b04c))

## [2.59.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.3...v2.59.4) (2026-08-17)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.15 ([#1391](https://github.com/intent-hq/cloudlands-fe/issues/1391)) ([2c690fb](https://github.com/intent-hq/cloudlands-fe/commit/2c690fb4053a6874f06ee97d408b4eb20027813f))

## [2.59.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.2...v2.59.3) (2026-08-17)


### 🐛 Bug Fixes

* keep remote file picker open when setting provider CLI path ([#1387](https://github.com/intent-hq/cloudlands-fe/issues/1387)) ([d181eb2](https://github.com/intent-hq/cloudlands-fe/commit/d181eb290295a5342a3398fc3a9e8142295cb066))

## [2.59.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.1...v2.59.2) (2026-08-17)


### 🐛 Bug Fixes

* **chat:** defer transcript reveal on switch-back until resubscribe snapshot applies ([#1384](https://github.com/intent-hq/cloudlands-fe/issues/1384)) ([00827f3](https://github.com/intent-hq/cloudlands-fe/commit/00827f37e633d86047073b34f81f1035a41ac219))
* drop deleted/pending-delete agents from HUD and clean bridge state on agent:deleted ([#1385](https://github.com/intent-hq/cloudlands-fe/issues/1385)) ([dba8c52](https://github.com/intent-hq/cloudlands-fe/commit/dba8c520fba8863c2ab517e603d0e922757e2f04))

## [2.59.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.59.0...v2.59.1) (2026-08-17)


### 🐛 Bug Fixes

* bridge window:set-theme and extend IPC audit to saga-style invoke sites ([#1380](https://github.com/intent-hq/cloudlands-fe/issues/1380)) ([e489dd4](https://github.com/intent-hq/cloudlands-fe/commit/e489dd48c2ab0c29fe051f6d2009cd52c7583ef3))
* bump intentd sidecar to v0.7.14 ([#1382](https://github.com/intent-hq/cloudlands-fe/issues/1382)) ([f70a9cd](https://github.com/intent-hq/cloudlands-fe/commit/f70a9cd80ee0cc389f69affb16d07d4b2210fbdf))

## [2.59.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.58.0...v2.59.0) (2026-08-17)


### 🚀 Features

* redesign the release notes dialog ([#1379](https://github.com/intent-hq/cloudlands-fe/issues/1379)) ([9f95a0b](https://github.com/intent-hq/cloudlands-fe/commit/9f95a0b8697ae1cdadf72dcd2144c3e3340f5466))

## [2.58.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.57.1...v2.58.0) (2026-08-17)


### 🚀 Features

* **chat:** opt into incremental chat delta encoding (deltaEncoding: incremental) ([#1370](https://github.com/intent-hq/cloudlands-fe/issues/1370)) ([7f20011](https://github.com/intent-hq/cloudlands-fe/commit/7f200112c58041a54deed0b7fc495ef865bbc299))


### 🐛 Bug Fixes

* capitalize merge-blocked reason in sidebar PR tooltip ([#1365](https://github.com/intent-hq/cloudlands-fe/issues/1365)) ([5da5aab](https://github.com/intent-hq/cloudlands-fe/commit/5da5aab84aa7952a77b7de86cab4b4a01f036235))
* make chat send animation reliable via retried pending-send matching ([#1367](https://github.com/intent-hq/cloudlands-fe/issues/1367)) ([4ddabd8](https://github.com/intent-hq/cloudlands-fe/commit/4ddabd80f2bc3d479403fc357d989d5a255b1c95))
* rebuild the transcript when a divergent seq-0 snapshot races an idle stream ([#1364](https://github.com/intent-hq/cloudlands-fe/issues/1364)) ([7e58df2](https://github.com/intent-hq/cloudlands-fe/commit/7e58df2f9103e4f25809bbae62cc83401e2b5322))
* stop doubling "blocked by" in Monitored PRs readiness line ([#1366](https://github.com/intent-hq/cloudlands-fe/issues/1366)) ([b3cd7eb](https://github.com/intent-hq/cloudlands-fe/commit/b3cd7eb2833591b5939bde7ce1b02e60033216a4))
* track 4+-space-indented fences as code regions in tag scanning ([#1362](https://github.com/intent-hq/cloudlands-fe/issues/1362)) ([c600304](https://github.com/intent-hq/cloudlands-fe/commit/c6003045d3c8463146e8390aa73c16ef25e5defc))

## [2.57.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.57.0...v2.57.1) (2026-08-17)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.13 ([#1361](https://github.com/intent-hq/cloudlands-fe/issues/1361)) ([b28dbce](https://github.com/intent-hq/cloudlands-fe/commit/b28dbcec14cc5dc083f323749bb891b28a29ce5d))
* rebuild the chat transcript when the daemon re-emits seq-0 on the same subscription ([#1359](https://github.com/intent-hq/cloudlands-fe/issues/1359)) ([12ee028](https://github.com/intent-hq/cloudlands-fe/commit/12ee0281bb4f7dfe2cb5a3e039f1b73a68d4d3ee))
* treat group/think tag literals in code spans and fences as literal text ([#1358](https://github.com/intent-hq/cloudlands-fe/issues/1358)) ([e8cf272](https://github.com/intent-hq/cloudlands-fe/commit/e8cf27297a95202ed726041ee427162926925d83))

## [2.57.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.7...v2.57.0) (2026-08-17)


### 🚀 Features

* show the actual default model when the daemon preview is absent ([#1355](https://github.com/intent-hq/cloudlands-fe/issues/1355)) ([3ea5712](https://github.com/intent-hq/cloudlands-fe/commit/3ea57128bec8893aa8fe13909614dd39bd5f3345))


### 🐛 Bug Fixes

* retry seq-0 snapshot wait in transcript hydration instead of failing the load ([#1356](https://github.com/intent-hq/cloudlands-fe/issues/1356)) ([0bc7a83](https://github.com/intent-hq/cloudlands-fe/commit/0bc7a832325c0989cc3e9293908f131bd08a1dfa))

## [2.56.7](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.6...v2.56.7) (2026-08-17)


### 🐛 Bug Fixes

* stop hardwareConsole.state bag wipes on failed settings read ([#1351](https://github.com/intent-hq/cloudlands-fe/issues/1351)) ([390cfc5](https://github.com/intent-hq/cloudlands-fe/commit/390cfc5439b9f88da6866f4bc021d8cdc7e9ed8c))

## [2.56.6](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.5...v2.56.6) (2026-08-17)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.12 ([#1352](https://github.com/intent-hq/cloudlands-fe/issues/1352)) ([eadd6cd](https://github.com/intent-hq/cloudlands-fe/commit/eadd6cdb0f6f7492d60b11da950e856bcff9c78c))
* only clear genuinely invalid restored model overrides in InitialAgentPicker ([#1350](https://github.com/intent-hq/cloudlands-fe/issues/1350)) ([9e0a7c4](https://github.com/intent-hq/cloudlands-fe/commit/9e0a7c4053fa303df3cfb9087c1cd2cb9b35a91c))

## [2.56.5](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.4...v2.56.5) (2026-08-17)


### 🐛 Bug Fixes

* decode TOON-encoded workspace_api delegate results in chat parser ([#1347](https://github.com/intent-hq/cloudlands-fe/issues/1347)) ([88c0075](https://github.com/intent-hq/cloudlands-fe/commit/88c00756c3ccefff53b25a60be6407e8135e586a))

## [2.56.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.3...v2.56.4) (2026-08-16)


### 🐛 Bug Fixes

* drop the stateSnapshot existing-sessions exception from settings copy ([#1345](https://github.com/intent-hq/cloudlands-fe/issues/1345)) ([c72cc1f](https://github.com/intent-hq/cloudlands-fe/commit/c72cc1fd23207a59d18116a443247086abefec49))

## [2.56.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.2...v2.56.3) (2026-08-16)


### 🐛 Bug Fixes

* let an exported NODE_OPTIONS heap cap override the renderer build default ([#1341](https://github.com/intent-hq/cloudlands-fe/issues/1341)) ([a6c08c8](https://github.com/intent-hq/cloudlands-fe/commit/a6c08c8b0ffe0b5a71d024f3bca9785fc94624c3))
* reconcile tunnel forwards against workspace state on reconnect ([#1334](https://github.com/intent-hq/cloudlands-fe/issues/1334)) ([de5d079](https://github.com/intent-hq/cloudlands-fe/commit/de5d079258e7d47c56f3da93b3957356b3787a50))

## [2.56.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.1...v2.56.2) (2026-08-16)


### 🐛 Bug Fixes

* atomic chat first-paint from the seq-0 snapshot and gate utility card on transcript load ([#1327](https://github.com/intent-hq/cloudlands-fe/issues/1327)) ([2cca565](https://github.com/intent-hq/cloudlands-fe/commit/2cca5653a7bbbabd482af53ad7eb36d5ef8c8307))
* bump intentd sidecar to v0.7.11 ([#1338](https://github.com/intent-hq/cloudlands-fe/issues/1338)) ([79abb6e](https://github.com/intent-hq/cloudlands-fe/commit/79abb6e62e2aa294e6a4feadc9c7a0847257d9bf))
* load directory picker paths with takeLatest so mid-flight clicks cannot strand the spinner ([#1333](https://github.com/intent-hq/cloudlands-fe/issues/1333)) ([8ebb511](https://github.com/intent-hq/cloudlands-fe/commit/8ebb5119303dbe7eb300c4ecceaeb713b55efc23))

## [2.56.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.56.0...v2.56.1) (2026-08-16)


### 🐛 Bug Fixes

* damp scroll-to-bottom button visibility against scroll-metric jitter ([#1331](https://github.com/intent-hq/cloudlands-fe/issues/1331)) ([9cdff07](https://github.com/intent-hq/cloudlands-fe/commit/9cdff07f64affdd647ce990b43f0142c83e785a2))
* remote directory picker infinite spinner and unvalidated favorites ([#1329](https://github.com/intent-hq/cloudlands-fe/issues/1329)) ([6262852](https://github.com/intent-hq/cloudlands-fe/commit/6262852c558a2a664fb5d775cf447eab69e4a643))
* settle window for LazyTurn swap-out to stop boundary oscillation ([#1330](https://github.com/intent-hq/cloudlands-fe/issues/1330)) ([ae37de9](https://github.com/intent-hq/cloudlands-fe/commit/ae37de945148bda2a0af75261d7339fcd35b7971))

## [2.56.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.55.0...v2.56.0) (2026-08-16)


### 🚀 Features

* persist tunnel forwards for the app lifetime with workspace-scoped cleanup ([#1325](https://github.com/intent-hq/cloudlands-fe/issues/1325)) ([383e05d](https://github.com/intent-hq/cloudlands-fe/commit/383e05d08d585a80f1dcae1c4be1c1103db391ad))

## [2.55.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.54.1...v2.55.0) (2026-08-16)


### 🚀 Features

* harness features modal dialog ([#1323](https://github.com/intent-hq/cloudlands-fe/issues/1323)) ([c3b87f5](https://github.com/intent-hq/cloudlands-fe/commit/c3b87f5f8d45d9c6958dfafed3cb5807c349a9c5))


### 🐛 Bug Fixes

* auto-size daemon status menu and show disk sizes in decimal units ([#1321](https://github.com/intent-hq/cloudlands-fe/issues/1321)) ([83f22b3](https://github.com/intent-hq/cloudlands-fe/commit/83f22b31c333c778e7f8c99cc552e07bc2e72166))
* bump intentd sidecar to v0.7.10 ([#1326](https://github.com/intent-hq/cloudlands-fe/issues/1326)) ([1b70977](https://github.com/intent-hq/cloudlands-fe/commit/1b70977e26c34b4a751981df4e56e3e56b6ba429))

## [2.54.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.54.0...v2.54.1) (2026-08-16)


### 🐛 Bug Fixes

* add spacing below transfer modal server section label ([#1320](https://github.com/intent-hq/cloudlands-fe/issues/1320)) ([d70a348](https://github.com/intent-hq/cloudlands-fe/commit/d70a3486a9b6b9c71464bfcbcb0e5ace8f9beaf9))

## [2.54.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.53.2...v2.54.0) (2026-08-16)


### 🚀 Features

* list local intentd as a workspace transfer target ([#1315](https://github.com/intent-hq/cloudlands-fe/issues/1315)) ([081cc2c](https://github.com/intent-hq/cloudlands-fe/commit/081cc2cd3265def7541bae2f4c86c4d1669cfd48))
* show harness version in agent tab actions menu ([#1317](https://github.com/intent-hq/cloudlands-fe/issues/1317)) ([e2c1bd4](https://github.com/intent-hq/cloudlands-fe/commit/e2c1bd42cc13167de20e2ccf9d704dc7d371a4fe))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.9 ([#1319](https://github.com/intent-hq/cloudlands-fe/issues/1319)) ([82d4529](https://github.com/intent-hq/cloudlands-fe/commit/82d452966a054b59eacf7797d177f3308b871ed6))
* convert DirectoryPickerModal to bits-ui Dialog for nested-modal layer coordination ([#1313](https://github.com/intent-hq/cloudlands-fe/issues/1313)) ([33cd058](https://github.com/intent-hq/cloudlands-fe/commit/33cd058b8d0d7a26f656f02872a811c584639414))
* refresh daemon-assigned MCP server ids and statuses after settings mutations ([#1316](https://github.com/intent-hq/cloudlands-fe/issues/1316)) ([6c0bac6](https://github.com/intent-hq/cloudlands-fe/commit/6c0bac65d71b7eb0601ec3e42849869677b823da))

## [2.53.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.53.1...v2.53.2) (2026-08-16)


### 🐛 Bug Fixes

* render daemon-reported MCP server status instead of fabricating Connected ([#1309](https://github.com/intent-hq/cloudlands-fe/issues/1309)) ([f876418](https://github.com/intent-hq/cloudlands-fe/commit/f87641819ee674dcf513c5f73cd04c2e129e3a35))

## [2.53.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.53.0...v2.53.1) (2026-08-16)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.8 ([#1311](https://github.com/intent-hq/cloudlands-fe/issues/1311)) ([9003fe3](https://github.com/intent-hq/cloudlands-fe/commit/9003fe365806a6eb7de0e4377023de1b7a9b923a))
* repo picker RECENT list — no open-time pre-fill filtering, include workspace-derived GitHub repos ([#1308](https://github.com/intent-hq/cloudlands-fe/issues/1308)) ([c696d28](https://github.com/intent-hq/cloudlands-fe/commit/c696d28645bad0d0408f5d2dae751795e204672b))
* report browser.exec delivery and stop workspace-less tab broadcasts ([#1307](https://github.com/intent-hq/cloudlands-fe/issues/1307)) ([ab99a27](https://github.com/intent-hq/cloudlands-fe/commit/ab99a27aba27dc41661a938ba0ca10c6ca836490))

## [2.53.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.52.0...v2.53.0) (2026-08-16)


### 🚀 Features

* show harness version in conversation ellipsis menu ([#1303](https://github.com/intent-hq/cloudlands-fe/issues/1303)) ([39e1e7a](https://github.com/intent-hq/cloudlands-fe/commit/39e1e7aec944180cbc5d57059006236f8e97040a))
* show workspace disk space in the daemon status menu ([#1300](https://github.com/intent-hq/cloudlands-fe/issues/1300)) ([0d08884](https://github.com/intent-hq/cloudlands-fe/commit/0d088841c4cb2a3ba8e6963ede30c05d075885ba))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.7 ([#1310](https://github.com/intent-hq/cloudlands-fe/issues/1310)) ([9fffeaa](https://github.com/intent-hq/cloudlands-fe/commit/9fffeaac02ed4118821e1b91ee3e50923846fb23))
* implement workspace.get + task.listAgentLinks in the dev:web browser mock ([#1305](https://github.com/intent-hq/cloudlands-fe/issues/1305)) ([8a2f716](https://github.com/intent-hq/cloudlands-fe/commit/8a2f716447d78675894c7ca8c0146fd430353400))

## [2.52.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.5...v2.52.0) (2026-08-16)


### 🚀 Features

* virtualize workspace columns in horizontal mode (windowed mounting) ([#1243](https://github.com/intent-hq/cloudlands-fe/issues/1243)) ([2cc586f](https://github.com/intent-hq/cloudlands-fe/commit/2cc586f57ca295a6d4c605e3f374b9ed8640459f))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.6 ([#1304](https://github.com/intent-hq/cloudlands-fe/issues/1304)) ([14f57da](https://github.com/intent-hq/cloudlands-fe/commit/14f57da82eb54104ef1377c04d95605526374833))

## [2.51.5](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.4...v2.51.5) (2026-08-16)


### 🐛 Bug Fixes

* restore team specialists in new-agent picker ([#1298](https://github.com/intent-hq/cloudlands-fe/issues/1298)) ([2506be0](https://github.com/intent-hq/cloudlands-fe/commit/2506be07f903c25b3cf56fe30a5d0925d18fbd02))

## [2.51.4](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.3...v2.51.4) (2026-08-16)


### 🐛 Bug Fixes

* deflake ui-component-audit tests by running the audit in-process ([#1296](https://github.com/intent-hq/cloudlands-fe/issues/1296)) ([29f5c58](https://github.com/intent-hq/cloudlands-fe/commit/29f5c580c48e9ca19cbb676c1dbb5cc039928620))

## [2.51.3](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.2...v2.51.3) (2026-08-16)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.5 ([#1297](https://github.com/intent-hq/cloudlands-fe/issues/1297)) ([02c9f23](https://github.com/intent-hq/cloudlands-fe/commit/02c9f23797c6e3dad10d07db05fd320289c914d5))
* rebuild held first-message send params as plain JSON so Svelte \ proxies survive Electron IPC ([#1293](https://github.com/intent-hq/cloudlands-fe/issues/1293)) ([1e3d5c6](https://github.com/intent-hq/cloudlands-fe/commit/1e3d5c640bf0a35489fd0c66ba787a2cdbedbb4a))
* suppress protocol-mismatch modal on boot restore of a remote backend ([#1295](https://github.com/intent-hq/cloudlands-fe/issues/1295)) ([5d85096](https://github.com/intent-hq/cloudlands-fe/commit/5d8509616f4d2552ac8ef3a3a4ca62d740afd0d2))

## [2.51.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.1...v2.51.2) (2026-08-15)


### 🐛 Bug Fixes

* restore workspace UI session (panels, browser tabs, terminals) across app restarts ([#1286](https://github.com/intent-hq/cloudlands-fe/issues/1286)) ([ae02abd](https://github.com/intent-hq/cloudlands-fe/commit/ae02abd61195598e88a5263d5ea2e5c88dfcfa0e))

## [2.51.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.51.0...v2.51.1) (2026-08-15)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.3 ([#1289](https://github.com/intent-hq/cloudlands-fe/issues/1289)) ([ac8c793](https://github.com/intent-hq/cloudlands-fe/commit/ac8c7932135584eee4abde32500a6b59e74115dc))
* read remote-attachment bytes off the FE host instead of the daemon ([#1287](https://github.com/intent-hq/cloudlands-fe/issues/1287)) ([c18719f](https://github.com/intent-hq/cloudlands-fe/commit/c18719fec90ee2bd909abf1b1440c46767ebc66e))

## [2.51.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.50.0...v2.51.0) (2026-08-15)


### 🚀 Features

* **browser:** programmatic tunnel actions (openTunnel/listTunnels/closeTunnel) ([#1277](https://github.com/intent-hq/cloudlands-fe/issues/1277)) ([1cf60a9](https://github.com/intent-hq/cloudlands-fe/commit/1cf60a939dfa7f141ed83b04c1bea6d91c8f61c4))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.2 ([#1284](https://github.com/intent-hq/cloudlands-fe/issues/1284)) ([cca7ce8](https://github.com/intent-hq/cloudlands-fe/commit/cca7ce8dec2514a6a83379df845f9219c08defc4))

## [2.50.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.49.1...v2.50.0) (2026-08-15)


### 🚀 Features

* **browser:** dedupe model-opened tabs by exact URL on openTab ([#1276](https://github.com/intent-hq/cloudlands-fe/issues/1276)) ([92ab1a3](https://github.com/intent-hq/cloudlands-fe/commit/92ab1a3dbb0b2a3ec598d7653e0bbb2a467c493d))
* make BackgroundHooksRow countdowns tick every second ([#1278](https://github.com/intent-hq/cloudlands-fe/issues/1278)) ([648d944](https://github.com/intent-hq/cloudlands-fe/commit/648d9442ac503ec1021713140f9305cb0e3faf6b))


### 🐛 Bug Fixes

* align pinned prompt overlay width with conversation bubbles ([#1283](https://github.com/intent-hq/cloudlands-fe/issues/1283)) ([b1055b1](https://github.com/intent-hq/cloudlands-fe/commit/b1055b1844f733d7f6148b911f44cb2407e909f6))
* **browser:** make listTabs and closeTab agree on which tabs exist ([#1274](https://github.com/intent-hq/cloudlands-fe/issues/1274)) ([4d88ad8](https://github.com/intent-hq/cloudlands-fe/commit/4d88ad8dd5f5a9040cf98ea5aa87f8eabf5d7197))
* guard view-PR action tooltip against teardown race in WorkspaceProgressCard ([#1280](https://github.com/intent-hq/cloudlands-fe/issues/1280)) ([392bfe0](https://github.com/intent-hq/cloudlands-fe/commit/392bfe084ddf516549220460bbf0d0493dd18b47))
* make queued-notice chip legible on primary user-message surface ([#1281](https://github.com/intent-hq/cloudlands-fe/issues/1281)) ([94ef32b](https://github.com/intent-hq/cloudlands-fe/commit/94ef32bba36cb4a401af15b0780fa577561f0eb2))
* remove horizontal scrollbar in monitored-PR kebab menu ([#1279](https://github.com/intent-hq/cloudlands-fe/issues/1279)) ([6d400ef](https://github.com/intent-hq/cloudlands-fe/commit/6d400ef405eb7c1b77d97100e876408b29f7c588))

## [2.49.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.49.0...v2.49.1) (2026-08-15)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.1 ([#1272](https://github.com/intent-hq/cloudlands-fe/issues/1272)) ([e57521f](https://github.com/intent-hq/cloudlands-fe/commit/e57521f6f6ef51f7034195df2bbf6cfd8068dfc6))
* restore workspace interaction and presentation contracts ([#1268](https://github.com/intent-hq/cloudlands-fe/issues/1268)) ([19cafec](https://github.com/intent-hq/cloudlands-fe/commit/19cafec14f6d7fb135e98d09ef3794fed7cfcc11))

## [2.49.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.48.1...v2.49.0) (2026-08-15)


### 🚀 Features

* show repo name in monitored-PR chip labels ([#1258](https://github.com/intent-hq/cloudlands-fe/issues/1258)) ([690ac34](https://github.com/intent-hq/cloudlands-fe/commit/690ac34ebcf4f4a93207715d0252a7ccd0c16db0))


### 🐛 Bug Fixes

* advance queue snapshot seq on hydrate-reconciled folds ([#1261](https://github.com/intent-hq/cloudlands-fe/issues/1261)) ([ba68b20](https://github.com/intent-hq/cloudlands-fe/commit/ba68b20c327ed026cea5d1afa1bb7ec6afcd5d13))
* stop hidden scroll-lock button from flickering message actions on hover ([#1263](https://github.com/intent-hq/cloudlands-fe/issues/1263)) ([e22619c](https://github.com/intent-hq/cloudlands-fe/commit/e22619c638ace604a8bc2a29eadc126f0b66b7dd))

## [2.48.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.48.0...v2.48.1) (2026-08-15)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.7.0 ([#1266](https://github.com/intent-hq/cloudlands-fe/issues/1266)) ([97efa9d](https://github.com/intent-hq/cloudlands-fe/commit/97efa9dd3250dac1ad14499652a8957dcbb12c84))

## [2.48.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.47.0...v2.48.0) (2026-08-15)


### 🚀 Features

* embellish secondary-root commit rows to match the primary timeline ([#1260](https://github.com/intent-hq/cloudlands-fe/issues/1260)) ([77ee875](https://github.com/intent-hq/cloudlands-fe/commit/77ee8752226af598b0b7466511b5100806652429))


### 🐛 Bug Fixes

* keep surviving panels sized and steady when a close collapses a split ([#1264](https://github.com/intent-hq/cloudlands-fe/issues/1264)) ([7fa7e34](https://github.com/intent-hq/cloudlands-fe/commit/7fa7e344590459477bb575b6039332a764fdbe65))
* replace fixed truncation caps with width-responsive truncation on hook/PR wake labels ([#1259](https://github.com/intent-hq/cloudlands-fe/issues/1259)) ([556c644](https://github.com/intent-hq/cloudlands-fe/commit/556c644dc8cdd208f647e976d422976191db697c))

## [2.47.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.46.0...v2.47.0) (2026-08-15)


### 🚀 Features

* detect orphaned sidecar intentd and offer kill-and-restart recovery ([#1246](https://github.com/intent-hq/cloudlands-fe/issues/1246)) ([331cd8b](https://github.com/intent-hq/cloudlands-fe/commit/331cd8bcaafad4cbb9c0a5a9e917379affb66701))
* download non-editor attachments on chip click ([#1250](https://github.com/intent-hq/cloudlands-fe/issues/1250)) ([c959ce2](https://github.com/intent-hq/cloudlands-fe/commit/c959ce21c71b11f73b64d6d19dc56252b19d6d6d))
* gate release notifier on cross-repo fix completeness ([#1245](https://github.com/intent-hq/cloudlands-fe/issues/1245)) ([0995520](https://github.com/intent-hq/cloudlands-fe/commit/0995520edc859e6239ce20f800dba942e7f905ad))
* thread gitRootId through the commit changeset view ([#1255](https://github.com/intent-hq/cloudlands-fe/issues/1255)) ([5ddcdb4](https://github.com/intent-hq/cloudlands-fe/commit/5ddcdb467cb19c5c466420adcc042eb4ce75807d))


### 🐛 Bug Fixes

* exclude inset padding from vertical panel reference size ([#1257](https://github.com/intent-hq/cloudlands-fe/issues/1257)) ([3f6c83c](https://github.com/intent-hq/cloudlands-fe/commit/3f6c83ce6064ddf5b9430dc9affd6efa4fafd5c4))
* gate bottom-anchored ledger restore on the native clamp firing ([#1256](https://github.com/intent-hq/cloudlands-fe/issues/1256)) ([31eccf7](https://github.com/intent-hq/cloudlands-fe/commit/31eccf751346a284cfd5d3f6df9465b406727443))
* guard queued-response queue seed against fresher live snapshots ([#1253](https://github.com/intent-hq/cloudlands-fe/issues/1253)) ([0567e6d](https://github.com/intent-hq/cloudlands-fe/commit/0567e6de34de46214cc728c2f833a3ae8c00746e))
* make workspace title edit input match display-mode width ([#1244](https://github.com/intent-hq/cloudlands-fe/issues/1244)) ([68b2159](https://github.com/intent-hq/cloudlands-fe/commit/68b2159c0f5ac58b5904d8b94132cb1fa2a3912d))
* render New messages divider after the inter-turn spacer ([#1254](https://github.com/intent-hq/cloudlands-fe/issues/1254)) ([ccd31ab](https://github.com/intent-hq/cloudlands-fe/commit/ccd31ab266f88b08f43edb67eda5ddb9eb56bf7d))
* size content-header title edit input to its content ([#1251](https://github.com/intent-hq/cloudlands-fe/issues/1251)) ([532f34d](https://github.com/intent-hq/cloudlands-fe/commit/532f34d23afb5a3a6d1cef6dff68bb5ab3170050))
* treat epoch-0 attribution timestamps as unknown in the command palette ([#1247](https://github.com/intent-hq/cloudlands-fe/issues/1247)) ([f2947b1](https://github.com/intent-hq/cloudlands-fe/commit/f2947b1388a10f7af70706f470188f808a010c7b))

## [2.46.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.45.1...v2.46.0) (2026-08-15)


### 🚀 Features

* align settings and new-workspace model pickers ([#1240](https://github.com/intent-hq/cloudlands-fe/issues/1240)) ([4e91cf9](https://github.com/intent-hq/cloudlands-fe/commit/4e91cf9fcf5c25fd55e45823734cbb23b04117b4))
* run bulk attachment transfers on per-transfer connections ([#1241](https://github.com/intent-hq/cloudlands-fe/issues/1241)) ([352d144](https://github.com/intent-hq/cloudlands-fe/commit/352d144112950ab629973a382a2e37e28eb885cf))


### 🐛 Bug Fixes

* gate the setup-card-only branch on settled hydration ([#1239](https://github.com/intent-hq/cloudlands-fe/issues/1239)) ([e4f4f68](https://github.com/intent-hq/cloudlands-fe/commit/e4f4f68e9e8816aea1266510aa17218d8c198011))

## [2.45.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.45.0...v2.45.1) (2026-08-14)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.21 ([#1237](https://github.com/intent-hq/cloudlands-fe/issues/1237)) ([a691086](https://github.com/intent-hq/cloudlands-fe/commit/a69108616a0d655433140917c846a632e7ede731))
* replace workspace tab status icons with one circle ([3da598e](https://github.com/intent-hq/cloudlands-fe/commit/3da598e9993bb7ad51fb8e1ed1f36fe1c5ba56bc))

## [2.45.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.44.0...v2.45.0) (2026-08-14)


### 🚀 Features

* add opt-in agentFeatures.taskGraph toggle to Agent Features settings ([#1234](https://github.com/intent-hq/cloudlands-fe/issues/1234)) ([5de1318](https://github.com/intent-hq/cloudlands-fe/commit/5de131827552bce0f840d15b4d3af7a87a29b4d8))

## [2.44.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.43.1...v2.44.0) (2026-08-14)


### 🚀 Features

* split secondary-root history at the registration boundary ([#1231](https://github.com/intent-hq/cloudlands-fe/issues/1231)) ([ddd20b6](https://github.com/intent-hq/cloudlands-fe/commit/ddd20b6d1b2defa7c7a24d4a8be39ed634b03057))


### 🐛 Bug Fixes

* emit unread-cycle stops for unhydrated unread workspaces ([#1233](https://github.com/intent-hq/cloudlands-fe/issues/1233)) ([acf5e2a](https://github.com/intent-hq/cloudlands-fe/commit/acf5e2a6639e5e07efb0d596c2ecaa029c52ad11))
* keep takeover edge arrowheads fixed-size when hover thickens the stroke ([#1230](https://github.com/intent-hq/cloudlands-fe/issues/1230)) ([82c55ba](https://github.com/intent-hq/cloudlands-fe/commit/82c55bab1747993a7adcf21619e8be86998da849))
* sidebar expanded-card artifacts — clipped tab strip and confusing actions menu ([#1229](https://github.com/intent-hq/cloudlands-fe/issues/1229)) ([bd53044](https://github.com/intent-hq/cloudlands-fe/commit/bd530440f0c3a4e5bf8251271a37e2802f6faae6))

## [2.43.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.43.0...v2.43.1) (2026-08-14)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.20 ([#1227](https://github.com/intent-hq/cloudlands-fe/issues/1227)) ([3a2cb66](https://github.com/intent-hq/cloudlands-fe/commit/3a2cb663fc5278530846e0fdbf570988e7a984f2))

## [2.43.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.42.0...v2.43.0) (2026-08-14)


### 🚀 Features

* make secondary-root branch label click-to-copy ([#1225](https://github.com/intent-hq/cloudlands-fe/issues/1225)) ([bb68521](https://github.com/intent-hq/cloudlands-fe/commit/bb68521eeff87e0e2c81753c47687dfa40a795c1))

## [2.42.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.41.0...v2.42.0) (2026-08-14)


### 🚀 Features

* expand attachment drop target to the whole conversation card ([#1221](https://github.com/intent-hq/cloudlands-fe/issues/1221)) ([9869519](https://github.com/intent-hq/cloudlands-fe/commit/986951903d078a059e067dc91e1f4e2e990e6e70))


### 🐛 Bug Fixes

* add spacing before new-workspace button when tabs overflow ([#1219](https://github.com/intent-hq/cloudlands-fe/issues/1219)) ([f822b4c](https://github.com/intent-hq/cloudlands-fe/commit/f822b4cefda53b5aed0f37006ecf0709a860b8f4))
* align sidebar Shell/Browser launcher labels with grid tiles ([#1222](https://github.com/intent-hq/cloudlands-fe/issues/1222)) ([3323535](https://github.com/intent-hq/cloudlands-fe/commit/3323535a3505490a64f8e0ec215ba21c3a4445a5))
* bump intentd sidecar to v0.6.19 ([#1224](https://github.com/intent-hq/cloudlands-fe/issues/1224)) ([43c94d5](https://github.com/intent-hq/cloudlands-fe/commit/43c94d5c62d3e9b84879c3c74d26b0d809673dfd))
* move URL resolution out of EmbeddedBrowser to the entry points ([#1220](https://github.com/intent-hq/cloudlands-fe/issues/1220)) ([1bffb3a](https://github.com/intent-hq/cloudlands-fe/commit/1bffb3a989fedbcce51f3006a693f8f8b80b951b))

## [2.41.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.40.0...v2.41.0) (2026-08-14)


### 🚀 Features

* takeover map spec-linked edges, hover edge highlight, wheel zoom ([#1205](https://github.com/intent-hq/cloudlands-fe/issues/1205)) ([1892cd3](https://github.com/intent-hq/cloudlands-fe/commit/1892cd3e199ad36f13704e2321f2eaf55f8311fc))


### 🐛 Bug Fixes

* eliminate bottom-of-chat phantom space snap-back via bottom-anchored clamp compensation ([#1203](https://github.com/intent-hq/cloudlands-fe/issues/1203)) ([4034ab4](https://github.com/intent-hq/cloudlands-fe/commit/4034ab4c0e1d1e2bb079d5910f06b276a18462e8))
* pass URLs targeting active tunnel-local forwards through the resolver untouched ([#1215](https://github.com/intent-hq/cloudlands-fe/issues/1215)) ([f6bf2a5](https://github.com/intent-hq/cloudlands-fe/commit/f6bf2a52f199db39182b92def3a453fee60ae0ca))
* remove redundant update-download spinner next to settings button ([#1216](https://github.com/intent-hq/cloudlands-fe/issues/1216)) ([7f1a395](https://github.com/intent-hq/cloudlands-fe/commit/7f1a3958d2a017639d62d8869936395ee2da487e))
* render waiting dot on all workspace card surfaces ([#1210](https://github.com/intent-hq/cloudlands-fe/issues/1210)) ([cd9bc1d](https://github.com/intent-hq/cloudlands-fe/commit/cd9bc1d2fd8b74c34d6212c37c62023b5d17fab8))
* reserve contained inset chrome in workspace column width ([#1204](https://github.com/intent-hq/cloudlands-fe/issues/1204)) ([f5a092c](https://github.com/intent-hq/cloudlands-fe/commit/f5a092c42c979ce1ab51e22a839749d02ffdc25b))
* stop scrolled-out tabs carving no-drag holes in the titlebar gap ([#1218](https://github.com/intent-hq/cloudlands-fe/issues/1218)) ([a235bd5](https://github.com/intent-hq/cloudlands-fe/commit/a235bd557a265cffe1830d2113a172e1a96c7909))
* sync route typegen in pnpm run check and fix dead /test route comparisons ([#1214](https://github.com/intent-hq/cloudlands-fe/issues/1214)) ([0787947](https://github.com/intent-hq/cloudlands-fe/commit/0787947918d30726fdf464f27c82d3a156de32fd))
* tab strip user scrolling and view-switcher spacing ([#1212](https://github.com/intent-hq/cloudlands-fe/issues/1212)) ([cc3571c](https://github.com/intent-hq/cloudlands-fe/commit/cc3571cd9bb18700cbaa22301c828945dc5755df))
* trust BE activity for the tab running indicator ([#1217](https://github.com/intent-hq/cloudlands-fe/issues/1217)) ([054be5d](https://github.com/intent-hq/cloudlands-fe/commit/054be5d0b614a64c22cf99bf6f190779eed544dd))

## [2.40.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.39.0...v2.40.0) (2026-08-14)


### 🚀 Features

* per-bundle lane stickiness in the takeover map edge router ([#1208](https://github.com/intent-hq/cloudlands-fe/issues/1208)) ([4d568e4](https://github.com/intent-hq/cloudlands-fe/commit/4d568e469a4b5e63578474da35ddeb4fe217eadd))
* wire live clone progress into onboarding setup card ([#1200](https://github.com/intent-hq/cloudlands-fe/issues/1200)) ([c0b8268](https://github.com/intent-hq/cloudlands-fe/commit/c0b8268dcdcdbe0b196111462708eb233a2bf3a9))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.18 ([#1211](https://github.com/intent-hq/cloudlands-fe/issues/1211)) ([5b3470f](https://github.com/intent-hq/cloudlands-fe/commit/5b3470fcffcb44671396381cf47448fe109133a2))
* **chat:** collapsed wake card formatting ([#1209](https://github.com/intent-hq/cloudlands-fe/issues/1209)) ([bd8231f](https://github.com/intent-hq/cloudlands-fe/commit/bd8231f075463fc799078c3f054d9cfc8710e18d))
* strengthen keyboard-focus indicator on DirectoryPickerView inputs ([#1207](https://github.com/intent-hq/cloudlands-fe/issues/1207)) ([d49f740](https://github.com/intent-hq/cloudlands-fe/commit/d49f740a4e3fc681a5e25fbcc89e505e61c92621))

## [2.39.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.38.0...v2.39.0) (2026-08-14)


### 🚀 Features

* bundle same-source takeover map edge lanes to narrow gutters ([#1197](https://github.com/intent-hq/cloudlands-fe/issues/1197)) ([052d164](https://github.com/intent-hq/cloudlands-fe/commit/052d1645598ad5e02f28e5319d2b3a2046db0764))
* **hardware-console:** prioritize blocked/question/discussion stops in the unread cycle walk ([#1192](https://github.com/intent-hq/cloudlands-fe/issues/1192)) ([b5025cc](https://github.com/intent-hq/cloudlands-fe/commit/b5025cc8f2ca680f6fd115edb94e39289bb39e53))
* make repo path in workspace hover card a copy link ([#1201](https://github.com/intent-hq/cloudlands-fe/issues/1201)) ([5d6cf77](https://github.com/intent-hq/cloudlands-fe/commit/5d6cf779b51bc6e698651be3533717579c6c4731))
* render a notice for refusal / max_tokens turn endings ([#1199](https://github.com/intent-hq/cloudlands-fe/issues/1199)) ([9b7f6a7](https://github.com/intent-hq/cloudlands-fe/commit/9b7f6a7e0e8fd9be6f1e4e124c19547e43b55c89))
* render budget-queued agents distinctly from slot-queued ones ([#1190](https://github.com/intent-hq/cloudlands-fe/issues/1190)) ([2650f2b](https://github.com/intent-hq/cloudlands-fe/commit/2650f2b16680150c5f49a14d88c2ead53ef3ea56))
* toast when a workspace auto-unarchives ([#1187](https://github.com/intent-hq/cloudlands-fe/issues/1187)) ([63649a5](https://github.com/intent-hq/cloudlands-fe/commit/63649a50448bebf0a1bc94db60c97de257080c80))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.17 ([#1202](https://github.com/intent-hq/cloudlands-fe/issues/1202)) ([6a83c71](https://github.com/intent-hq/cloudlands-fe/commit/6a83c71be0dbe20b3f29101e7cb147595ed3ae22))
* center-align relation pills and trailing buttons in task rows ([#1188](https://github.com/intent-hq/cloudlands-fe/issues/1188)) ([9618bdd](https://github.com/intent-hq/cloudlands-fe/commit/9618bdd5eb13bceb3e7f26bdce4ac7be57468d6b))
* compensate late-settling turn height changes above the viewport ([#1194](https://github.com/intent-hq/cloudlands-fe/issues/1194)) ([65745ed](https://github.com/intent-hq/cloudlands-fe/commit/65745ed072d7905ceb4383fb6fc22b03451b712d))
* daemon status dropdown a11y — no nested interactive tooltip triggers in menus, role=img on labeled icons ([#1189](https://github.com/intent-hq/cloudlands-fe/issues/1189)) ([b53fc89](https://github.com/intent-hq/cloudlands-fe/commit/b53fc89dc0655b6d402ffaef4fbe22534e170f71))
* layer global focus rules and add focus-within indicators to composite repo inputs ([#1195](https://github.com/intent-hq/cloudlands-fe/issues/1195)) ([628dbf2](https://github.com/intent-hq/cloudlands-fe/commit/628dbf2a82db2536b81af2cf195dd51a69772ea5))
* normalize onboarding branch/model chip heights and row spacing ([#1196](https://github.com/intent-hq/cloudlands-fe/issues/1196)) ([2ff1503](https://github.com/intent-hq/cloudlands-fe/commit/2ff1503dcc7f87dc886ddbebcb46da488cc84652))

## [2.38.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.37.0...v2.38.0) (2026-08-14)


### 🚀 Features

* extract shared loopback URL resolver and add browser:resolve-url IPC ([#1181](https://github.com/intent-hq/cloudlands-fe/issues/1181)) ([d539a74](https://github.com/intent-hq/cloudlands-fe/commit/d539a74540b52cc99bd2bf60bf3428277a90f688))
* route all embedded-browser loads through the resolve-url resolver ([#1183](https://github.com/intent-hq/cloudlands-fe/issues/1183)) ([31211e1](https://github.com/intent-hq/cloudlands-fe/commit/31211e1c60a6ac80edd697576a042b24b6e66b13))


### 🐛 Bug Fixes

* **chat:** restore reason-specific stopped indicator labels and add system_suspend ([#1185](https://github.com/intent-hq/cloudlands-fe/issues/1185)) ([20cf852](https://github.com/intent-hq/cloudlands-fe/commit/20cf852e0bf0cf3a657e48bf848f0ab0f904fd75))
* reconcile verified workspace UI refinements ([#1131](https://github.com/intent-hq/cloudlands-fe/issues/1131)) ([a7b016f](https://github.com/intent-hq/cloudlands-fe/commit/a7b016f78d863123df69f195484284afb0a44a38))
* stabilize New Workspace modal button and setup-script row heights ([#1186](https://github.com/intent-hq/cloudlands-fe/issues/1186)) ([a890f6d](https://github.com/intent-hq/cloudlands-fe/commit/a890f6deda57f9867b0565e6b37b7f36365338e3))

## [2.37.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.36.1...v2.37.0) (2026-08-14)


### 🚀 Features

* resolve loopback URLs against the daemon host in remote mode (rewrite, probe, tunnel fallback) ([e683ae6](https://github.com/intent-hq/cloudlands-fe/commit/e683ae6495f3e3b8dc872dde3d2700febe0e8cce))
* surface daemon workspace waiting flag in sidebar and HUD ([#1178](https://github.com/intent-hq/cloudlands-fe/issues/1178)) ([7498f5c](https://github.com/intent-hq/cloudlands-fe/commit/7498f5cf7c348ab64109678cac3549c59f636792))

## [2.36.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.36.0...v2.36.1) (2026-08-14)


### 🐛 Bug Fixes

* **hud:** count unread workspaces in both UNREAD and their state bucket ([#1172](https://github.com/intent-hq/cloudlands-fe/issues/1172)) ([a8588d6](https://github.com/intent-hq/cloudlands-fe/commit/a8588d6d945272fec5cad90aa54302953eaf9d74))
* **hud:** thicken workspace card unread blink border to 2px ([#1173](https://github.com/intent-hq/cloudlands-fe/issues/1173)) ([78ca820](https://github.com/intent-hq/cloudlands-fe/commit/78ca820f19ddc1ad31dcbfab5e4a1f7aaed7d9e2))
* preserve newlines losslessly in chat input restore and paste ([#1175](https://github.com/intent-hq/cloudlands-fe/issues/1175)) ([de57e82](https://github.com/intent-hq/cloudlands-fe/commit/de57e8242af7269722e6c274e9ea7bd837e22668))
* prevent each_key_duplicate crash in chat response-group rendering ([#1176](https://github.com/intent-hq/cloudlands-fe/issues/1176)) ([de21b1b](https://github.com/intent-hq/cloudlands-fe/commit/de21b1b7b8a7c5edb06d9b8a20144b022fcb81b3))
* stop sticky-row flicker at top of chat ([#1171](https://github.com/intent-hq/cloudlands-fe/issues/1171)) ([cbd3e3f](https://github.com/intent-hq/cloudlands-fe/commit/cbd3e3f9514c6b0c32abd6708ee2518c2056b1c8))

## [2.36.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.35.2...v2.36.0) (2026-08-14)


### 🚀 Features

* anchor takeover-map cards at the barycenter of their parents ([#1165](https://github.com/intent-hq/cloudlands-fe/issues/1165)) ([aa60056](https://github.com/intent-hq/cloudlands-fe/commit/aa60056dd351904f134ec7639ac6206e5cc8cd63))
* hide titlebar view toggle and new-workspace button during onboarding ([#1164](https://github.com/intent-hq/cloudlands-fe/issues/1164)) ([ec1a571](https://github.com/intent-hq/cloudlands-fe/commit/ec1a571569eff8a5f13ebccf58b74a98f18583ee))
* scroll columns view to workspace on hardware agent key press ([#1170](https://github.com/intent-hq/cloudlands-fe/issues/1170)) ([53f8e29](https://github.com/intent-hq/cloudlands-fe/commit/53f8e29c3d75b43a9f98ecf95535983448edb33c))
* show only user-authored queued messages in the chat queue ([#1167](https://github.com/intent-hq/cloudlands-fe/issues/1167)) ([292e3ce](https://github.com/intent-hq/cloudlands-fe/commit/292e3cef36d07c3736dc774d8b87eaade31f02df))
* surface intentd sidecar version mismatch in daemon status indicator ([#1168](https://github.com/intent-hq/cloudlands-fe/issues/1168)) ([f7f918e](https://github.com/intent-hq/cloudlands-fe/commit/f7f918e701ce86dd9d10912f90e29541607841d1))


### 🐛 Bug Fixes

* expose daemon-status warning tooltip text to assistive technology ([#1169](https://github.com/intent-hq/cloudlands-fe/issues/1169)) ([0ac9891](https://github.com/intent-hq/cloudlands-fe/commit/0ac9891361eea74757fd47d029bf1c0d8ce836a3))

## [2.35.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.35.1...v2.35.2) (2026-08-13)


### 🐛 Bug Fixes

* **auto-update:** re-validate downloaded update and cancel in-flight download on channel switch ([#1162](https://github.com/intent-hq/cloudlands-fe/issues/1162)) ([e288c52](https://github.com/intent-hq/cloudlands-fe/commit/e288c52c474e0729f808014a88905aa66d552781))
* gate welcome flow behind setup state on last-tab close ([#1159](https://github.com/intent-hq/cloudlands-fe/issues/1159)) ([03cef8e](https://github.com/intent-hq/cloudlands-fe/commit/03cef8e39f3f15eb2ea8fa0a7ed68aec6b58a08d))

## [2.35.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.35.0...v2.35.1) (2026-08-13)


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.16 ([#1157](https://github.com/intent-hq/cloudlands-fe/issues/1157)) ([2979a12](https://github.com/intent-hq/cloudlands-fe/commit/2979a12eb210eb3b91ad5cb39cdf3a03ad8af94d))

## [2.35.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.34.0...v2.35.0) (2026-08-13)


### 🚀 Features

* chunked upload path for large remote attachments (&gt;25MB) ([#1153](https://github.com/intent-hq/cloudlands-fe/issues/1153)) ([37b54b2](https://github.com/intent-hq/cloudlands-fe/commit/37b54b2848b4128533f8b110b249b4f1729ffc79))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.15 ([#1156](https://github.com/intent-hq/cloudlands-fe/issues/1156)) ([2963602](https://github.com/intent-hq/cloudlands-fe/commit/2963602652c85a226fae7c3975a78eb3b6c45b48))

## [2.34.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.33.0...v2.34.0) (2026-08-13)


### 🚀 Features

* embed reasoning effort slider in model picker ([#1105](https://github.com/intent-hq/cloudlands-fe/issues/1105)) ([e72efe8](https://github.com/intent-hq/cloudlands-fe/commit/e72efe827ef6ca19610fee48b6c5d81c52047b48))

## [2.33.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.32.0...v2.33.0) (2026-08-13)


### 🚀 Features

* drop unread displayStatus; unread overlays the real status ([#1151](https://github.com/intent-hq/cloudlands-fe/issues/1151)) ([e84fe2f](https://github.com/intent-hq/cloudlands-fe/commit/e84fe2fd3a0fc1aebfdcddaecde6c1388a0e5348))
* **hud:** orthogonal routed, color-coded dependency edges on the takeover task map ([#1146](https://github.com/intent-hq/cloudlands-fe/issues/1146)) ([0900676](https://github.com/intent-hq/cloudlands-fe/commit/09006760c5ea4d941feb75293bb534d24932ea6a))


### 🐛 Bug Fixes

* **auto-update:** broadcast update toasts to all workspace windows and check immediately on channel switch ([#1148](https://github.com/intent-hq/cloudlands-fe/issues/1148)) ([c43b5b7](https://github.com/intent-hq/cloudlands-fe/commit/c43b5b73fee3a025fb2ed73cb0367559da97388e))
* drive workspace tab bar from daemon workspace:updated archive events ([#1152](https://github.com/intent-hq/cloudlands-fe/issues/1152)) ([2822eeb](https://github.com/intent-hq/cloudlands-fe/commit/2822eebe4ff3d04cb44aa85bc6011e597cf891c4))
* **hud:** stop conflict pulse when an endpoint is cancelled ([#1150](https://github.com/intent-hq/cloudlands-fe/issues/1150)) ([5154e5f](https://github.com/intent-hq/cloudlands-fe/commit/5154e5fc01552d60b6cbbd6469e5f1543fe2522d))
* open create modal from GitHub link action and auto-redirect 404s to root route ([#1147](https://github.com/intent-hq/cloudlands-fe/issues/1147)) ([a9ccd8b](https://github.com/intent-hq/cloudlands-fe/commit/a9ccd8b7da73ae1d9abc4cd3adb89ff0fb645ad0))

## [2.32.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.31.0...v2.32.0) (2026-08-13)


### 🚀 Features

* add root '/' home route (empty state) ([#1141](https://github.com/intent-hq/cloudlands-fe/issues/1141)) ([c530332](https://github.com/intent-hq/cloudlands-fe/commit/c530332bf71d4ec87ba4fa5a507d947d068e4bcd))
* multi git root tracking — Changes tab root dropdown, sectioned PRs, read-only root browsing ([#1127](https://github.com/intent-hq/cloudlands-fe/issues/1127)) ([c96d3ca](https://github.com/intent-hq/cloudlands-fe/commit/c96d3ca036ba897a0b1a4be893bbd42a0c4a7605))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.14 ([#1139](https://github.com/intent-hq/cloudlands-fe/issues/1139)) ([5b4edb9](https://github.com/intent-hq/cloudlands-fe/commit/5b4edb9911959bcce3cf58183fae65da52bc1825))
* **chat:** render batch delegate dispositions instead of 'Agent spawned' ([#1135](https://github.com/intent-hq/cloudlands-fe/issues/1135)) ([3b3977c](https://github.com/intent-hq/cloudlands-fe/commit/3b3977c94724264bfc7e6b09dc3fcf3957750916))
* **git:** converge changes slice before stage/unstage seam resolves ([#1130](https://github.com/intent-hq/cloudlands-fe/issues/1130)) ([aa2a408](https://github.com/intent-hq/cloudlands-fe/commit/aa2a408c1d0cf60ccca3c7ecaa697f6624f5bbe1))
* **hud:** hide macOS traffic-light spacer in full screen ([#1144](https://github.com/intent-hq/cloudlands-fe/issues/1144)) ([b49e87a](https://github.com/intent-hq/cloudlands-fe/commit/b49e87a0834776a0f1ddb133e25cb1fee44fb77f))
* **hud:** keep takeover map at 1:1 zoom and add zoom controls ([#1140](https://github.com/intent-hq/cloudlands-fe/issues/1140)) ([d5eed99](https://github.com/intent-hq/cloudlands-fe/commit/d5eed99efd84ef687ed8cea94e63d36d61ffa3c8))
* **i18n:** restore immediate UI refresh on locale change and localize user-facing strings ([#1133](https://github.com/intent-hq/cloudlands-fe/issues/1133)) ([4b270fe](https://github.com/intent-hq/cloudlands-fe/commit/4b270fea899e4453b6744f9a9ec2831fd20264d1))
* make svelte-check gate actually check (exclude generated paraglide, add plausibility guard) ([#1138](https://github.com/intent-hq/cloudlands-fe/issues/1138)) ([e3e286f](https://github.com/intent-hq/cloudlands-fe/commit/e3e286f3536bc61bf7ae86ba6d38f326118b70f4))
* move forget/add active-id decisions inside the backend-switch queue ([#1137](https://github.com/intent-hq/cloudlands-fe/issues/1137)) ([bc1eacc](https://github.com/intent-hq/cloudlands-fe/commit/bc1eaccfb7f80dfff3765ca9cc5ba012f025ae5d))
* play HUD sound cues when manually opening a workspace ([#1143](https://github.com/intent-hq/cloudlands-fe/issues/1143)) ([034ac3e](https://github.com/intent-hq/cloudlands-fe/commit/034ac3ef1e9f203da9d00b6c100b9b9019abcd66))
* remove fixed width cropping monitored-PR chip menu labels ([#1145](https://github.com/intent-hq/cloudlands-fe/issues/1145)) ([abc69eb](https://github.com/intent-hq/cloudlands-fe/commit/abc69ebd62991d378f29fcf3ff5f219cbf65475b))
* serialize backend switches and guard stale hostname capture ([#1128](https://github.com/intent-hq/cloudlands-fe/issues/1128)) ([509cccb](https://github.com/intent-hq/cloudlands-fe/commit/509cccb153e0f4454fcf15f3bb8de8c9c57761be))
* **settings:** shorten agent memory budget and idle reap descriptions ([#1142](https://github.com/intent-hq/cloudlands-fe/issues/1142)) ([59e8217](https://github.com/intent-hq/cloudlands-fe/commit/59e8217c1724dfdceed92bf906dcd608bfb5d779))
* **terminal:** restore selectScript import in QuakeTerminalOverlay ([#1136](https://github.com/intent-hq/cloudlands-fe/issues/1136)) ([c6c6b3a](https://github.com/intent-hq/cloudlands-fe/commit/c6c6b3a8aa870483d7e3598a35738cf70bb4e309))


### ⚡ Performance

* restore guarded VirtualList path in WorkspaceAgentsList ([#1134](https://github.com/intent-hq/cloudlands-fe/issues/1134)) ([ff6cc1a](https://github.com/intent-hq/cloudlands-fe/commit/ff6cc1a7d60ccc0e197743ea58beff475cf248be))

## [2.31.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.30.1...v2.31.0) (2026-08-13)


### 🚀 Features

* polish workspace UI and navigation ([#1117](https://github.com/intent-hq/cloudlands-fe/issues/1117)) ([0e20ba9](https://github.com/intent-hq/cloudlands-fe/commit/0e20ba9c0fbf8e9087b79b40fb213c4b9fe81f59))
* **settings:** move Agent Backend to Advanced and surface the memory bounds ([#1087](https://github.com/intent-hq/cloudlands-fe/issues/1087)) ([9a9bf63](https://github.com/intent-hq/cloudlands-fe/commit/9a9bf636a7d2a8aa920ec805fb4598c3b52c8809))


### 🐛 Bug Fixes

* **chat:** recover fused group open tags and empty-name close tags ([#1122](https://github.com/intent-hq/cloudlands-fe/issues/1122)) ([e3b3d4f](https://github.com/intent-hq/cloudlands-fe/commit/e3b3d4f44d31fcfd8b0559d1824bbfa26cfd9638))
* **hud:** make HUD shell fill viewport height ([#1125](https://github.com/intent-hq/cloudlands-fe/issues/1125)) ([1a17be0](https://github.com/intent-hq/cloudlands-fe/commit/1a17be0d740beb2e349db9d6c37b118953e4a9aa))
* **onboarding:** exclude workspace-owned and daemon-managed checkouts from LocalRepoTab recents ([#1129](https://github.com/intent-hq/cloudlands-fe/issues/1129)) ([b93b76a](https://github.com/intent-hq/cloudlands-fe/commit/b93b76ad7740d9849a20155944ccadee588fdd1c))

## [2.30.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.30.0...v2.30.1) (2026-08-13)


### 🐛 Bug Fixes

* **chat:** restore queue visibility filter and render pr_monitor_wake rows ([#1120](https://github.com/intent-hq/cloudlands-fe/issues/1120)) ([a0dbebc](https://github.com/intent-hq/cloudlands-fe/commit/a0dbebc3b4add24147e6b63ef1d99b737d3ae365))

## [2.30.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.29.0...v2.30.0) (2026-08-13)


### 🚀 Features

* **hud:** render takeover map as a dependency graph with edges and zoom-to-fit ([#1110](https://github.com/intent-hq/cloudlands-fe/issues/1110)) ([b7ce4ec](https://github.com/intent-hq/cloudlands-fe/commit/b7ce4eccc6d1ac96f9baf921f6fad35f68001f88))


### 🐛 Bug Fixes

* bump intentd sidecar to v0.6.12 ([#1119](https://github.com/intent-hq/cloudlands-fe/issues/1119)) ([500092e](https://github.com/intent-hq/cloudlands-fe/commit/500092e7d374dec3c08de93cee81f0d8e91bdd88))

## [2.29.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.28.0...v2.29.0) (2026-08-13)


### 🚀 Features

* add file download and folder zip download to the sidebar file browser ([#1101](https://github.com/intent-hq/cloudlands-fe/issues/1101)) ([07aef9a](https://github.com/intent-hq/cloudlands-fe/commit/07aef9a0fda993b83e3056bcc613bca5966d0d6d))
* gate daemon-host desktop actions on workspace host locality ([#1114](https://github.com/intent-hq/cloudlands-fe/issues/1114)) ([4719955](https://github.com/intent-hq/cloudlands-fe/commit/471995584835ec4b02ab805c682b4ef2f164325a))
* **hud:** show hardware key slot as large square on HUD card and takeover header ([#1100](https://github.com/intent-hq/cloudlands-fe/issues/1100)) ([17af04e](https://github.com/intent-hq/cloudlands-fe/commit/17af04ee4215dfa3dbd46b501f62361b5e2ae2e9))
* **hud:** wire banner-typewriter and blink-tick sound cues into the takeover ([#1086](https://github.com/intent-hq/cloudlands-fe/issues/1086)) ([a7f5a2d](https://github.com/intent-hq/cloudlands-fe/commit/a7f5a2d1485163955f151655947dfe1920de9154))
* three-way update channel selector (stable/beta/alpha) ([#1113](https://github.com/intent-hq/cloudlands-fe/issues/1113)) ([e7bc8ec](https://github.com/intent-hq/cloudlands-fe/commit/e7bc8ec3bb3ce69ef37660026f75f2ddd62d68da))


### 🐛 Bug Fixes

* commit resolved onboarding provider selection when advancing from the welcome step ([#1109](https://github.com/intent-hq/cloudlands-fe/issues/1109)) ([6adb1fe](https://github.com/intent-hq/cloudlands-fe/commit/6adb1fe3356dfdf19b0f6b6813253e54b35b7073))
* load the drag-region no-drag rule globally so HUD header controls stay clickable ([#1098](https://github.com/intent-hq/cloudlands-fe/issues/1098)) ([a4d9e40](https://github.com/intent-hq/cloudlands-fe/commit/a4d9e40097c7dfeb6bde670088dae2f733ba4557))
* make daemon status menu fill viewport and use real submenus for connections ([#1088](https://github.com/intent-hq/cloudlands-fe/issues/1088)) ([8f46668](https://github.com/intent-hq/cloudlands-fe/commit/8f46668ae4057f4320f85746de64a3b169612831))
* pin the clock in memory-history tests so fixtures cannot age out ([#1107](https://github.com/intent-hq/cloudlands-fe/issues/1107)) ([604fd11](https://github.com/intent-hq/cloudlands-fe/commit/604fd11dfefba0d5c620b84798eb557206d5c680))
* place attachments via the data arm on remote backends and surface placement failure reasons ([#1089](https://github.com/intent-hq/cloudlands-fe/issues/1089)) ([fe93153](https://github.com/intent-hq/cloudlands-fe/commit/fe931534b6ae0531f48860e851c59f4b3d5f9cb4))
* preserve repo selection in the post-create form state ([#1102](https://github.com/intent-hq/cloudlands-fe/issues/1102)) ([847b30b](https://github.com/intent-hq/cloudlands-fe/commit/847b30b5f597adcd5d7e57c4774f6d116ee1dfb9))
* prevent clipping of two-line option buttons in transfer wizard ([#1103](https://github.com/intent-hq/cloudlands-fe/issues/1103)) ([3a98479](https://github.com/intent-hq/cloudlands-fe/commit/3a98479ded6f298e65dcfd9f9c582fad16c444f6))
* rank contiguous substring matches above scattered subsequence in palette fuzzyScore ([#1096](https://github.com/intent-hq/cloudlands-fe/issues/1096)) ([17b90b2](https://github.com/intent-hq/cloudlands-fe/commit/17b90b251c7ce6229677f6d31a80ec5d81fdd4e5))
* re-wire ChatPanel to createChatDraftManager (restore [#742](https://github.com/intent-hq/cloudlands-fe/issues/742)) ([29c17bd](https://github.com/intent-hq/cloudlands-fe/commit/29c17bdbcc411275a0b226807bb4c33a7f0ee057))
* resolve the Linux intentd socket path via the XDG data dir ([#1099](https://github.com/intent-hq/cloudlands-fe/issues/1099)) ([1c1e49c](https://github.com/intent-hq/cloudlands-fe/commit/1c1e49ce2c8ab49cf910d97a3bb76c6e7dff49da))
* restore backend-derived setup gate on the boot path ([#1091](https://github.com/intent-hq/cloudlands-fe/issues/1091)) ([fbe3310](https://github.com/intent-hq/cloudlands-fe/commit/fbe3310bca6f245635a19b4eaa19ddd69bd82380))
* restore GitHub link Show choices menu after redesign ([#1106](https://github.com/intent-hq/cloudlands-fe/issues/1106)) ([bec4dcb](https://github.com/intent-hq/cloudlands-fe/commit/bec4dcb488ce29cc21e54bf9cfa9bb2a4e183a9a))
* restore Pick-a-repo-first tab order and keep githubUrl in restore-recent hydration ([#1108](https://github.com/intent-hq/cloudlands-fe/issues/1108)) ([8142354](https://github.com/intent-hq/cloudlands-fe/commit/8142354bbc91bb513dfc7d5ac7dc7265e0397072))
* surface unmet Node.js requirement as a once-per-session toast in the app shell ([#1095](https://github.com/intent-hq/cloudlands-fe/issues/1095)) ([cd9c2c9](https://github.com/intent-hq/cloudlands-fe/commit/cd9c2c90a3b3f8262b315d40b89ecc0be65c318b))

## [2.28.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.27.0...v2.28.0) (2026-08-12)


### 🚀 Features

* redesign the workspace experience ([#1031](https://github.com/intent-hq/cloudlands-fe/issues/1031)) ([df7aa1f](https://github.com/intent-hq/cloudlands-fe/commit/df7aa1f124043e55a2654b24399500acfb7f7438))


### 🐛 Bug Fixes

* move getIpcListenerCounts into the preload template ([#1084](https://github.com/intent-hq/cloudlands-fe/issues/1084)) ([3bdd19c](https://github.com/intent-hq/cloudlands-fe/commit/3bdd19c080b66aa87ecbfc07232a3ed6325f5625))

## [2.27.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.26.0...v2.27.0) (2026-08-12)


### 🚀 Features

* add context-scoped saga effects ([#1022](https://github.com/intent-hq/cloudlands-fe/issues/1022)) ([6c3fd6e](https://github.com/intent-hq/cloudlands-fe/commit/6c3fd6e8a553ddd152a8ddd706026f4c91aa5552))
* add relations section to task note view with linked dependsOn / depended-on-by / conflictsWith ([#1052](https://github.com/intent-hq/cloudlands-fe/issues/1052)) ([2e3fae9](https://github.com/intent-hq/cloudlands-fe/commit/2e3fae9b0966ce7fc8114363b2667a87af81c87b))
* chat loading state + resume via sinceMessageId ([#1032](https://github.com/intent-hq/cloudlands-fe/issues/1032)) ([69d5674](https://github.com/intent-hq/cloudlands-fe/commit/69d56746d5a203c6a2518910ddbf4244ea07180e))
* consume daemon-provided unmetDependsOn on note-shaped payloads ([#1050](https://github.com/intent-hq/cloudlands-fe/issues/1050)) ([19bb9ef](https://github.com/intent-hq/cloudlands-fe/commit/19bb9ef8f19033d9a392d7ea07f79c2e188b3c54))
* daemon-owned delete undo for workspace and agent deletion ([#1037](https://github.com/intent-hq/cloudlands-fe/issues/1037)) ([77a6065](https://github.com/intent-hq/cloudlands-fe/commit/77a6065a1129003efa343709ac985df1c3adfe9f))
* **debug-export:** include a memory timeline in the debug bundle ([#1073](https://github.com/intent-hq/cloudlands-fe/issues/1073)) ([2f3711c](https://github.com/intent-hq/cloudlands-fe/commit/2f3711cec88c2e82adb33e5e2213aa2ca586a4ab))
* expose fan-out subscriber counts to the retention fingerprint ([#1082](https://github.com/intent-hq/cloudlands-fe/issues/1082)) ([8189e09](https://github.com/intent-hq/cloudlands-fe/commit/8189e09a007211cb32afcc28a9951e5fc9b6df7a))
* HUD sound effects pack with speaker toggle ([#1071](https://github.com/intent-hq/cloudlands-fe/issues/1071)) ([470104a](https://github.com/intent-hq/cloudlands-fe/commit/470104a27ad47f07905521ab166a030fb2e28085))
* **i18n:** introduce Chinese product name in zh catalogs ([#1018](https://github.com/intent-hq/cloudlands-fe/issues/1018)) ([12dd217](https://github.com/intent-hq/cloudlands-fe/commit/12dd21793f92eb0be182e43b68d61d6a88312811))
* import workspace from file (File menu + wizard) ([#1079](https://github.com/intent-hq/cloudlands-fe/issues/1079)) ([650e313](https://github.com/intent-hq/cloudlands-fe/commit/650e3134f306c1dfac36f07cd74c26d57c6d7ead))
* include intentd daemon logs in the debug bundle ([#1057](https://github.com/intent-hq/cloudlands-fe/issues/1057)) ([0d72c6d](https://github.com/intent-hq/cloudlands-fe/commit/0d72c6dbc95e50d310c55fd3ffc9cbd8dcdfdf65))
* log a periodic renderer retention fingerprint ([#1074](https://github.com/intent-hq/cloudlands-fe/issues/1074)) ([9d7f608](https://github.com/intent-hq/cloudlands-fe/commit/9d7f608302fd6f4ec15ca28f48c1642cde9c404d))
* **main:** sample per-process memory into console-output.log ([#1067](https://github.com/intent-hq/cloudlands-fe/issues/1067)) ([debea90](https://github.com/intent-hq/cloudlands-fe/commit/debea9008466da392fc879978dacd7e4e862c768))
* mirror task relations (dependsOn/conflictsWith) and render dependency/conflict chips on task rows ([#1038](https://github.com/intent-hq/cloudlands-fe/issues/1038)) ([e8e2c73](https://github.com/intent-hq/cloudlands-fe/commit/e8e2c73dbb8b172c98097a3906e56adc850d26ba))
* opportunistically warm the daemon repo cache on GitHub repo selection ([#1040](https://github.com/intent-hq/cloudlands-fe/issues/1040)) ([de0c752](https://github.com/intent-hq/cloudlands-fe/commit/de0c75282f79e94be1f267a692d75ae36eb435cb))
* place oversized chat attachments in the workspace via file.placeAttachment ([#1034](https://github.com/intent-hq/cloudlands-fe/issues/1034)) ([dd89db7](https://github.com/intent-hq/cloudlands-fe/commit/dd89db742bc81fcb7bca92f3e70faa08fd837369))
* rework monitored-PR chip menu to Check and Flush / Open in App / Open in External Browser / Cancel ([#1045](https://github.com/intent-hq/cloudlands-fe/issues/1045)) ([941d655](https://github.com/intent-hq/cloudlands-fe/commit/941d65582407009eb52eb165ba8687bcd40e1150))
* route submodule (gitlink) entries to a dedicated pin presentation in the Changes tab ([#1035](https://github.com/intent-hq/cloudlands-fe/issues/1035)) ([4d8844a](https://github.com/intent-hq/cloudlands-fe/commit/4d8844a8e9a248fdbb769d81d6379eb91ca3448b))
* select primary PR as oldest unmerged, else latest merged, incl. monitored PRs ([#1042](https://github.com/intent-hq/cloudlands-fe/issues/1042)) ([e74a661](https://github.com/intent-hq/cloudlands-fe/commit/e74a6616cc2687bf7d71e02cdf7be7c9d8e5a46a))
* server-side branch prefix search in BranchSelector ([#1019](https://github.com/intent-hq/cloudlands-fe/issues/1019)) ([79bc9eb](https://github.com/intent-hq/cloudlands-fe/commit/79bc9eb8ffc3fed8eeb790d72b2442a9f7a84a2e))
* show remote machine name next to daemon status dot ([#1030](https://github.com/intent-hq/cloudlands-fe/issues/1030)) ([1263849](https://github.com/intent-hq/cloudlands-fe/commit/126384955fdf83b27a417a6eb30eac289677fa6f))
* single-transfer chat hydration from the standing subscription snapshot ([#1036](https://github.com/intent-hq/cloudlands-fe/issues/1036)) ([a9e4558](https://github.com/intent-hq/cloudlands-fe/commit/a9e4558a4f2169324c3c5557395e4ff6dd266aeb))
* unified attachment flow with attachment-reference fileBlocks and sourcePath-only placement ([#1077](https://github.com/intent-hq/cloudlands-fe/issues/1077)) ([cdc37a5](https://github.com/intent-hq/cloudlands-fe/commit/cdc37a525ae84a593f2a4743129cc5e36c51ee36))
* workspace Transfer/Download wizard (relay transfer + archive download) ([#1056](https://github.com/intent-hq/cloudlands-fe/issues/1056)) ([15a89a7](https://github.com/intent-hq/cloudlands-fe/commit/15a89a78bc392e1ba6104314ceb069489fa96200))


### 🐛 Bug Fixes

* accept @@[@task](https://github.com/task) fence header attributes in task block parser ([#1062](https://github.com/intent-hq/cloudlands-fe/issues/1062)) ([d0e2a33](https://github.com/intent-hq/cloudlands-fe/commit/d0e2a33ebf3a81044fc70adeb50414b0b2d0a817))
* add trailing refetch to notes-read-service coalescer ([#1053](https://github.com/intent-hq/cloudlands-fe/issues/1053)) ([2854b33](https://github.com/intent-hq/cloudlands-fe/commit/2854b3393978c731d83b2be17bbad4c62abf85c8))
* bound diff worker pool lifetime and rendered-AST cache ([#1066](https://github.com/intent-hq/cloudlands-fe/issues/1066)) ([0c49cc0](https://github.com/intent-hq/cloudlands-fe/commit/0c49cc0564d4bec095f2ca120599436151b9583f))
* bound the per-workspace lifecycle read fan-out ([#1061](https://github.com/intent-hq/cloudlands-fe/issues/1061)) ([56a7a74](https://github.com/intent-hq/cloudlands-fe/commit/56a7a747dc8650fafe63d10186e02556cf33b799))
* dedup aggregate chat-changes tabs with a synthetic messageId ([#1047](https://github.com/intent-hq/cloudlands-fe/issues/1047)) ([c24ed97](https://github.com/intent-hq/cloudlands-fe/commit/c24ed9785331dfb6a79432809040bc47f0d793ec))
* deflake ModelPicker tests with observable waits ([#1076](https://github.com/intent-hq/cloudlands-fe/issues/1076)) ([e032787](https://github.com/intent-hq/cloudlands-fe/commit/e0327877b760f68f64e7f53f7450a9102a8c40ac))
* distinguish git-check transport failure from missing git ([#1029](https://github.com/intent-hq/cloudlands-fe/issues/1029)) ([274062b](https://github.com/intent-hq/cloudlands-fe/commit/274062bf56fb245e70bf88ac3a6cf04bf86b4814))
* download-mode copy in Transfer/Download wizard ([#1058](https://github.com/intent-hq/cloudlands-fe/issues/1058)) ([38c083b](https://github.com/intent-hq/cloudlands-fe/commit/38c083ba31fee83325d7d0d3b8aad22ca33d97f5))
* fail loudly when the retention fingerprint cannot read store state ([#1081](https://github.com/intent-hq/cloudlands-fe/issues/1081)) ([f68d1f9](https://github.com/intent-hq/cloudlands-fe/commit/f68d1f9b6e24607aeaeda649bf22e5717ed37564))
* fall back to top-level transport when building first stats ([#1023](https://github.com/intent-hq/cloudlands-fe/issues/1023)) ([166bbd7](https://github.com/intent-hq/cloudlands-fe/commit/166bbd7e7a4628335b60453cc01e54f71fd1a3b8))
* handle expired hook state in background-hooks service ([#1059](https://github.com/intent-hq/cloudlands-fe/issues/1059)) ([0b3a95f](https://github.com/intent-hq/cloudlands-fe/commit/0b3a95fd1986e2f1ad21631b9e7f6408113cb7f3))
* keep provider enablement across boot settings hydration races ([#1044](https://github.com/intent-hq/cloudlands-fe/issues/1044)) ([fbae6ef](https://github.com/intent-hq/cloudlands-fe/commit/fbae6ef944dc84a63f1e8be7ff22735bc2785414))
* preserve last-known provider availability on transient probe failures ([#1046](https://github.com/intent-hq/cloudlands-fe/issues/1046)) ([9e22c57](https://github.com/intent-hq/cloudlands-fe/commit/9e22c57789d9453e351bcb3d3d25dface967620a))
* preserve unmetDependsOn on mutation-response note upserts ([#1055](https://github.com/intent-hq/cloudlands-fe/issues/1055)) ([34d874f](https://github.com/intent-hq/cloudlands-fe/commit/34d874fbdd65757ba3240cad02bb84c8aa6a2905))
* prevent silent exit-1 in release notifier on stale runner tags ([#1028](https://github.com/intent-hq/cloudlands-fe/issues/1028)) ([4f2f6a4](https://github.com/intent-hq/cloudlands-fe/commit/4f2f6a4319a2d2b0e458774455f518e135dc7113))
* reflow monitored-PR hover card to line-per-fact layout ([#1020](https://github.com/intent-hq/cloudlands-fe/issues/1020)) ([80a1885](https://github.com/intent-hq/cloudlands-fe/commit/80a18853fa55cf97acbbca3c48f889b7343d2b8f))
* rehydrate initialAgentId from agent metadata ([#1026](https://github.com/intent-hq/cloudlands-fe/issues/1026)) ([2022b08](https://github.com/intent-hq/cloudlands-fe/commit/2022b08d3ca49a70dffb17ea6d396aa56ad3c9ea))
* remove hardcoded ~/intent WORKSPACE_BASE constants and path helpers ([#1025](https://github.com/intent-hq/cloudlands-fe/issues/1025)) ([233b0bf](https://github.com/intent-hq/cloudlands-fe/commit/233b0bff0efdb514d18154cb3514cbb2172fa731))
* render delegated agent card from workspace_api JSON results ([#1063](https://github.com/intent-hq/cloudlands-fe/issues/1063)) ([7fb0779](https://github.com/intent-hq/cloudlands-fe/commit/7fb0779a4de14da6a8a06b577bb76d6c63061ba8))
* resolve file links with submodule/worktree-relative paths instead of bare "File not found" ([#1070](https://github.com/intent-hq/cloudlands-fe/issues/1070)) ([bbb5953](https://github.com/intent-hq/cloudlands-fe/commit/bbb5953f68532d386b4cc306f68f914bf8f5791f))
* respect pendingDeleteAt on direct agent reads and handle delete-cancelled events ([#1039](https://github.com/intent-hq/cloudlands-fe/issues/1039)) ([2af3592](https://github.com/intent-hq/cloudlands-fe/commit/2af35926d04da772248dab1a711fbe2f3ce3b75c))
* restore chat-changes and local-changes tab opening in workspace-navigation tab saga ([#1043](https://github.com/intent-hq/cloudlands-fe/issues/1043)) ([287bfd6](https://github.com/intent-hq/cloudlands-fe/commit/287bfd61d1160b44ff7cfc8fc5de248a7366e033))
* restore stale-banner clear on redrive and parentAgentId failure-toast gate ([#1049](https://github.com/intent-hq/cloudlands-fe/issues/1049)) ([e9f8389](https://github.com/intent-hq/cloudlands-fe/commit/e9f83892ba810b05c5d198121f053f1101a89259))
* reword +N PR badge tooltip to "workspace PRs" ([#1033](https://github.com/intent-hq/cloudlands-fe/issues/1033)) ([37783fc](https://github.com/intent-hq/cloudlands-fe/commit/37783fc65f4928ac732484e23aaf2f6500a6d947))
* route command-shaped ACP tool calls to the terminal renderer ([#1048](https://github.com/intent-hq/cloudlands-fe/issues/1048)) ([5093496](https://github.com/intent-hq/cloudlands-fe/commit/50934962baf397a00432789c15fae81089dc699f))
* route hardware-console input to a single last-focused owner window ([#1041](https://github.com/intent-hq/cloudlands-fe/issues/1041)) ([76ea3bf](https://github.com/intent-hq/cloudlands-fe/commit/76ea3bf5ca5b18d105774fe996fe9d0dde7c7e72))
* share one backend:notification IPC listener across subscribers ([#1072](https://github.com/intent-hq/cloudlands-fe/issues/1072)) ([1a0f1de](https://github.com/intent-hq/cloudlands-fe/commit/1a0f1de1f9f3f9f52327e98a8cc9b6e3e4dd36fa))
* strip hook-wake prefix using exact metadata hook name ([#1060](https://github.com/intent-hq/cloudlands-fe/issues/1060)) ([11cc6f9](https://github.com/intent-hq/cloudlands-fe/commit/11cc6f90850c6236c886198a4424fb0607e6df55))
* switch completeOnce quick-action and slug contracts to JSON ([#1065](https://github.com/intent-hq/cloudlands-fe/issues/1065)) ([bc2b5f3](https://github.com/intent-hq/cloudlands-fe/commit/bc2b5f34824ba8ea7955965c9e052a68d84bd2d4))
* vendor @inlang/plugin-message-format locally instead of fetching from CDN ([#1024](https://github.com/intent-hq/cloudlands-fe/issues/1024)) ([da07c62](https://github.com/intent-hq/cloudlands-fe/commit/da07c620f35f0ad5e53bf32c04d34af7d1ff9419))
* withhold partial group tags from the streaming transcript ([#1068](https://github.com/intent-hq/cloudlands-fe/issues/1068)) ([344189d](https://github.com/intent-hq/cloudlands-fe/commit/344189dfad7c2e06aff648170cbf960f86be1e13))
* withhold partial think tags from the streaming transcript ([#1080](https://github.com/intent-hq/cloudlands-fe/issues/1080)) ([f8d0bc8](https://github.com/intent-hq/cloudlands-fe/commit/f8d0bc8f28447d494703cd2cd0c963725f1548ce))


### ⚡ Performance

* gate per-workspace HUD reads on card visibility ([#1075](https://github.com/intent-hq/cloudlands-fe/issues/1075)) ([475e8d7](https://github.com/intent-hq/cloudlands-fe/commit/475e8d70008cde1ff98e70838c86c703b0838162))

## [2.26.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.25.0...v2.26.0) (2026-08-11)


### 🚀 Features

* **hud:** restore compact peak y-axis label on TOK/S chart ([#1012](https://github.com/intent-hq/cloudlands-fe/issues/1012)) ([6157f4e](https://github.com/intent-hq/cloudlands-fe/commit/6157f4ea4bed5037cf39b1a9eda28aec5869ca0e))


### 🐛 Bug Fixes

* hide detected-repo Select row when it duplicates a suggestion ([#1014](https://github.com/intent-hq/cloudlands-fe/issues/1014)) ([810b306](https://github.com/intent-hq/cloudlands-fe/commit/810b30694d68fadc46638b4ee9d791feb5de0305))
* hydrate sidebar workspace circles from workspace.list taskStats ([#1011](https://github.com/intent-hq/cloudlands-fe/issues/1011)) ([eaeee1b](https://github.com/intent-hq/cloudlands-fe/commit/eaeee1bb25f0bc6a90da48a22aae9db96274ebbc))
* keep merged monitored PR pills on completed workspace cards ([#1016](https://github.com/intent-hq/cloudlands-fe/issues/1016)) ([8c52fe7](https://github.com/intent-hq/cloudlands-fe/commit/8c52fe7bd4b8f2fc4303463aa6d6a8c8b9eba5f9))
* **model:** make onboarding model pick durable as the global default ([#1009](https://github.com/intent-hq/cloudlands-fe/issues/1009)) ([e639ac0](https://github.com/intent-hq/cloudlands-fe/commit/e639ac0fd60f1c7e4296e747ebfb3345a6f9b1c0))
* **settings:** seed default-provider enablement entry on hydration ([#1015](https://github.com/intent-hq/cloudlands-fe/issues/1015)) ([62d7940](https://github.com/intent-hq/cloudlands-fe/commit/62d79402a1d2dc43923dd17e41353502ce899c09))
* **specialists:** refetch specialist.list when model-resolution settings change ([#1004](https://github.com/intent-hq/cloudlands-fe/issues/1004)) ([7134c91](https://github.com/intent-hq/cloudlands-fe/commit/7134c91fa52a566733a911047c95b36130721d9b))

## [2.25.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.24.0...v2.25.0) (2026-08-10)


### 🚀 Features

* **browser:** add closeTab action to the browser.exec CDP action catalog ([#1008](https://github.com/intent-hq/cloudlands-fe/issues/1008)) ([4c32ac3](https://github.com/intent-hq/cloudlands-fe/commit/4c32ac3e54d8854b53eca4483cce7315e6d198ce))
* execute-only setup scripts — remove the saved-scripts library ([#994](https://github.com/intent-hq/cloudlands-fe/issues/994)) ([72e2bfa](https://github.com/intent-hq/cloudlands-fe/commit/72e2bfafc6e0ca60195bb6a43420a115c17830d0))
* live provisioning progress on the Create workspace button ([#997](https://github.com/intent-hq/cloudlands-fe/issues/997)) ([3239143](https://github.com/intent-hq/cloudlands-fe/commit/3239143f3742e2464137b9ae6173c89f53a1b3d7))
* **notifications:** suppress agent:idle notifications for archived workspaces ([#1007](https://github.com/intent-hq/cloudlands-fe/issues/1007)) ([b9f2671](https://github.com/intent-hq/cloudlands-fe/commit/b9f2671bbe703622ebe09858befda5d04bcd4f8a))
* **onboarding:** picked-repo GitHub flow + honest provider availability ([#1001](https://github.com/intent-hq/cloudlands-fe/issues/1001)) ([289cddb](https://github.com/intent-hq/cloudlands-fe/commit/289cddb83d37800d4b55eb5d708484209f720331))
* paint ls-remote fallback branches and parallelize authoritative reads ([#1005](https://github.com/intent-hq/cloudlands-fe/issues/1005)) ([b0ecfa3](https://github.com/intent-hq/cloudlands-fe/commit/b0ecfa3df7095e5cbcea1f0f90a62f8842e782d9))
* un-gate cortex — visibility rides the daemon catalog verdict ([#1002](https://github.com/intent-hq/cloudlands-fe/issues/1002)) ([7fb12f3](https://github.com/intent-hq/cloudlands-fe/commit/7fb12f3be6893f6c80905692eda68738cae1d5c7))


### 🐛 Bug Fixes

* onboarding prompt UI — Using-row spacing, provider-default icon, image drag-and-drop ([#1006](https://github.com/intent-hq/cloudlands-fe/issues/1006)) ([e0d8566](https://github.com/intent-hq/cloudlands-fe/commit/e0d8566acb1811d2056d26f0b058bc068f276b8c))

## [2.24.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.23.0...v2.24.0) (2026-08-10)


### 🚀 Features

* correlate workspace.create provisioning progress via FE-minted progressId ([#968](https://github.com/intent-hq/cloudlands-fe/issues/968)) ([0615546](https://github.com/intent-hq/cloudlands-fe/commit/06155466dd71d8833648f2b9b14207a17e681ebd))
* flag untranslated identical-to-English catalog values in i18n lint ([#999](https://github.com/intent-hq/cloudlands-fe/issues/999)) ([a09f570](https://github.com/intent-hq/cloudlands-fe/commit/a09f570a9326cf8ae64cdeb5dc3c3683c46638db))
* restore Ctrl+Tab workspace switcher keyboard controller ([#990](https://github.com/intent-hq/cloudlands-fe/issues/990)) ([3522ad1](https://github.com/intent-hq/cloudlands-fe/commit/3522ad16c30c0476fc6c82197e98aa0cc162119e))


### 🐛 Bug Fixes

* fail closed on unknown provider gating verdict (absent hiddenProviders) ([#985](https://github.com/intent-hq/cloudlands-fe/issues/985)) ([f8db494](https://github.com/intent-hq/cloudlands-fe/commit/f8db4944a0ba1a07b33c9034153980530f6b8a0a))
* hide Sample intentd Process menu item on Windows with local sidecar ([#983](https://github.com/intent-hq/cloudlands-fe/issues/983)) ([76a9ac8](https://github.com/intent-hq/cloudlands-fe/commit/76a9ac8e77850d35434d6845d61f1fb123bfc689))
* keep app.css $lib [@imports](https://github.com/imports) first so editor styles ship in production builds ([#993](https://github.com/intent-hq/cloudlands-fe/issues/993)) ([17b2448](https://github.com/intent-hq/cloudlands-fe/commit/17b2448ec6f42755c863f891f6142d84bfe71a1c))
* remove FE binary caching; use uncached host.checkNode / host.checkGh ([#979](https://github.com/intent-hq/cloudlands-fe/issues/979)) ([7e1c789](https://github.com/intent-hq/cloudlands-fe/commit/7e1c789e709230c40229938b64a2e4d77de9e5ac))
* remove hardcoded '~/intent' WORKSPACE_ROOT config-browser module ([#984](https://github.com/intent-hq/cloudlands-fe/issues/984)) ([5670b8a](https://github.com/intent-hq/cloudlands-fe/commit/5670b8a4ab8698e9960781ac671db0b9369edeaf))
* scope no-drag rule to drag regions so scrolled content cannot carve titlebar holes ([#992](https://github.com/intent-hq/cloudlands-fe/issues/992)) ([ac10c80](https://github.com/intent-hq/cloudlands-fe/commit/ac10c8056859c2dda8f523116d655c0b2b7fe393))
* stack hook hover-card timing items on separate lines ([#996](https://github.com/intent-hq/cloudlands-fe/issues/996)) ([c1ce1f9](https://github.com/intent-hq/cloudlands-fe/commit/c1ce1f9ebfa786da89b1814d9833445112184c7e))
* stop monitored-PR hover card rendering literal markup whitespace ([#998](https://github.com/intent-hq/cloudlands-fe/issues/998)) ([625f3dd](https://github.com/intent-hq/cloudlands-fe/commit/625f3dd18716d5881fab4b97fe3c5554f00205cb))
* translate remaining modals_connect_* strings in non-English catalogs ([#977](https://github.com/intent-hq/cloudlands-fe/issues/977)) ([9e5d308](https://github.com/intent-hq/cloudlands-fe/commit/9e5d308aecb915011469a051937484387309cf75))
* translate untranslated i18n catalog values across all locales ([#995](https://github.com/intent-hq/cloudlands-fe/issues/995)) ([68e7015](https://github.com/intent-hq/cloudlands-fe/commit/68e701537751667da24dc6d881ff1146c326a70c))

## [2.23.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.22.0...v2.23.0) (2026-08-10)


### 🚀 Features

* add 'Sample intentd Process' Help menu item ([#975](https://github.com/intent-hq/cloudlands-fe/issues/975)) ([e5f8ad8](https://github.com/intent-hq/cloudlands-fe/commit/e5f8ad8e30981c9410203322008d6c24d629d8b0))
* add visible Effort label to AI Behavior effort dropdowns ([#947](https://github.com/intent-hq/cloudlands-fe/issues/947)) ([7eba38b](https://github.com/intent-hq/cloudlands-fe/commit/7eba38be4972bef8fbe42f4011f70059ceb8ece9))
* group settings providers by Enabled / Available / Not Detected ([#959](https://github.com/intent-hq/cloudlands-fe/issues/959)) ([be76c72](https://github.com/intent-hq/cloudlands-fe/commit/be76c72b14c923019b388911794c174ef721f6e8))
* scope the file:* daemon-events subscription to the active workspace ([#946](https://github.com/intent-hq/cloudlands-fe/issues/946)) ([19774d0](https://github.com/intent-hq/cloudlands-fe/commit/19774d02f4c7293cd1a69ff2a1bd0b39fcba967b))
* show external connection details and reconnect attempts in daemon-stopped overlay ([#957](https://github.com/intent-hq/cloudlands-fe/issues/957)) ([d101612](https://github.com/intent-hq/cloudlands-fe/commit/d1016122d2e2670db617c976c815641c32949dca))
* **sidebar:** drop same-org PR repo prefix and restore hover status ([#955](https://github.com/intent-hq/cloudlands-fe/issues/955)) ([587445c](https://github.com/intent-hq/cloudlands-fe/commit/587445c9137c31a927f1c3b0b38cc46546db5e9b))
* store all backend IPs on pairing and race them on (re)connect ([#976](https://github.com/intent-hq/cloudlands-fe/issues/976)) ([bd1d74e](https://github.com/intent-hq/cloudlands-fe/commit/bd1d74e7b7b50c38b747637055279dc0d4e1108a))


### 🐛 Bug Fixes

* always label settings back control Back ([#951](https://github.com/intent-hq/cloudlands-fe/issues/951)) ([aa14347](https://github.com/intent-hq/cloudlands-fe/commit/aa14347a9829f82d500237b37b4c0aeac907c116))
* cancel deferred workspaces load on layout unmount ([#954](https://github.com/intent-hq/cloudlands-fe/issues/954)) ([4b297db](https://github.com/intent-hq/cloudlands-fe/commit/4b297db44eb3d876a13be06512c5ac398687e1ec))
* dedupe GitHub repo entries in sidebar new-workspace card ([#950](https://github.com/intent-hq/cloudlands-fe/issues/950)) ([4224f3e](https://github.com/intent-hq/cloudlands-fe/commit/4224f3eb17d8dfc5edb2bc99f497facb4f2e3aa1))
* don't send auto-restored setupScript on workspace.create ([#956](https://github.com/intent-hq/cloudlands-fe/issues/956)) ([80fdba0](https://github.com/intent-hq/cloudlands-fe/commit/80fdba00843b8e80c7f3c7aa0f81fe69c4daf343))
* guard layout route suites against late console output racing worker teardown ([#948](https://github.com/intent-hq/cloudlands-fe/issues/948)) ([1f52e74](https://github.com/intent-hq/cloudlands-fe/commit/1f52e74b1a432d3adba952d877f56a248159a996))
* keep Recent repos in RepoSelector GitHub suggestion list ([#952](https://github.com/intent-hq/cloudlands-fe/issues/952)) ([08a91b2](https://github.com/intent-hq/cloudlands-fe/commit/08a91b20b0b12e57e1785fcc42249e127585a5e4))
* re-run boot-time model catalog load on backend reconnect ([#965](https://github.com/intent-hq/cloudlands-fe/issues/965)) ([cb8489e](https://github.com/intent-hq/cloudlands-fe/commit/cb8489e879d94ce0d6e19ebe4e5ce6af052d163b))
* recover in-flight update check toast on saga init ([#944](https://github.com/intent-hq/cloudlands-fe/issues/944)) ([a5de3cb](https://github.com/intent-hq/cloudlands-fe/commit/a5de3cb3b8ec5799257082a331c2f4a6ca64abca))
* remove dead WORKSPACE_ROOT IPC channel and its homedir-derived root guess ([#967](https://github.com/intent-hq/cloudlands-fe/issues/967)) ([cbde334](https://github.com/intent-hq/cloudlands-fe/commit/cbde3348e0a83b725041be6416aeb17e488c20e5))
* render gitlink entries as submodule pseudo-diffs in Changes tab ([#971](https://github.com/intent-hq/cloudlands-fe/issues/971)) ([9754338](https://github.com/intent-hq/cloudlands-fe/commit/9754338faa718dee09b053a24806f4048f329f4b))
* render info-only WebSocket API settings panel on remote connections ([#942](https://github.com/intent-hq/cloudlands-fe/issues/942)) ([054ea35](https://github.com/intent-hq/cloudlands-fe/commit/054ea356846eabcfde7be76c09f85a5c3f9ae5b9))
* render release notes with MarkdownViewer and drop typography plugin ([#969](https://github.com/intent-hq/cloudlands-fe/issues/969)) ([443c0bc](https://github.com/intent-hq/cloudlands-fe/commit/443c0bc3cbf6b1a04b889891122c724b8f157799))
* restore independent saga processing ([#974](https://github.com/intent-hq/cloudlands-fe/issues/974)) ([eb43fe5](https://github.com/intent-hq/cloudlands-fe/commit/eb43fe5a1402845bb6e965caac36d406f255253e))
* reword WebSocket API toggle description to lead with Intent-app remote access ([#949](https://github.com/intent-hq/cloudlands-fe/issues/949)) ([d825177](https://github.com/intent-hq/cloudlands-fe/commit/d8251774b5e346bc708f68fd43fd07cbc576ee64))
* sanitize markdown error fallbacks before {[@html](https://github.com/html)} injection ([#972](https://github.com/intent-hq/cloudlands-fe/issues/972)) ([19e6f91](https://github.com/intent-hq/cloudlands-fe/commit/19e6f91ca18a0d3124eb33970ed2e8148cc55184))
* stabilize onboarding provider order and dedupe no-provider toast ([#945](https://github.com/intent-hq/cloudlands-fe/issues/945)) ([4e0e4e6](https://github.com/intent-hq/cloudlands-fe/commit/4e0e4e6959e7bda0251b8b5097573210cd470784))
* style reasoning-effort slider to match app slider styling ([#958](https://github.com/intent-hq/cloudlands-fe/issues/958)) ([dadef5c](https://github.com/intent-hq/cloudlands-fe/commit/dadef5cdbe5e94c466b68bce2c0355e5321ab98c))
* surface WSS auth rejection and dedup connections by host:port ([#966](https://github.com/intent-hq/cloudlands-fe/issues/966)) ([381d7af](https://github.com/intent-hq/cloudlands-fe/commit/381d7af9b549eb3a4a1d26ce0f92cf74b6282370))
* unread-workspace cycling opens the last active top-level agent ([#973](https://github.com/intent-hq/cloudlands-fe/issues/973)) ([b0300dc](https://github.com/intent-hq/cloudlands-fe/commit/b0300dce89933c3d47c3a11ebfd1e6b3eb78da2f))
* unwrap single-field JSON tool results and soft-wrap tool output ([#953](https://github.com/intent-hq/cloudlands-fe/issues/953)) ([81ffb23](https://github.com/intent-hq/cloudlands-fe/commit/81ffb235059b825b1723f9ece258f01025e327ec))


### ⚡ Performance

* reduce renderer selector and subscription churn ([#970](https://github.com/intent-hq/cloudlands-fe/issues/970)) ([80002b4](https://github.com/intent-hq/cloudlands-fe/commit/80002b4552479ddadd67324ccae92219458cb5af))

## [2.22.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.21.0...v2.22.0) (2026-08-10)


### 🚀 Features

* add archived-workspace pill to palette chat-message search results ([#863](https://github.com/intent-hq/cloudlands-fe/issues/863)) ([b482639](https://github.com/intent-hq/cloudlands-fe/commit/b482639a4aa34089dd51d32f1c63e0cbf29ef9de))
* cached-first BranchSelector load via github.branches.listCached ([#860](https://github.com/intent-hq/cloudlands-fe/issues/860)) ([3dca2a4](https://github.com/intent-hq/cloudlands-fe/commit/3dca2a405f8c6d3d93db83037dae8dd6e112aab1))
* delete dead diffs stack and re-home browser snapshots to userData ([#913](https://github.com/intent-hq/cloudlands-fe/issues/913)) ([4226b64](https://github.com/intent-hq/cloudlands-fe/commit/4226b6487736540a558e2703eda468aa87ebaabc))
* delete legacy root-probing core + regression guard ([#922](https://github.com/intent-hq/cloudlands-fe/issues/922)) ([7e413a2](https://github.com/intent-hq/cloudlands-fe/commit/7e413a2f8c559e1f9daaddfec66333059dd0bf89))
* derive per-agent hasUnread from lastMessageId vs seen marker ([#928](https://github.com/intent-hq/cloudlands-fe/issues/928)) ([894b8b3](https://github.com/intent-hq/cloudlands-fe/commit/894b8b3e5186d9db3d1b3d5c08b94c0f10c5d9c3))
* derive setup gate from backend state instead of local completedSetup flag ([#935](https://github.com/intent-hq/cloudlands-fe/issues/935)) ([4befc37](https://github.com/intent-hq/cloudlands-fe/commit/4befc37c09f2a27ecb37b7088d2dbd15000e03c6))
* hide hook wake state note and convey post-fire state on the chip ([#929](https://github.com/intent-hq/cloudlands-fe/issues/929)) ([dc135cc](https://github.com/intent-hq/cloudlands-fe/commit/dc135cc6af522afc619aee4a96b234d706506051))
* PR-monitor wake attribution chip in chat ([#930](https://github.com/intent-hq/cloudlands-fe/issues/930)) ([a0f3790](https://github.com/intent-hq/cloudlands-fe/commit/a0f379003bb120c8d47c3121acad6c171377777d))
* reasoning dropdown improvements (restyle + global toggle + streaming tests) ([#857](https://github.com/intent-hq/cloudlands-fe/issues/857)) ([59ec561](https://github.com/intent-hq/cloudlands-fe/commit/59ec56189a06d387d8892d14d16319b0c5af400f))
* redesign settings sidebar and providers UX ([#938](https://github.com/intent-hq/cloudlands-fe/issues/938)) ([9003698](https://github.com/intent-hq/cloudlands-fe/commit/9003698c61270e2afdb96b676c7278ef24f9dac3))
* show relative durations in hook chip tooltip ([#912](https://github.com/intent-hq/cloudlands-fe/issues/912)) ([f909713](https://github.com/intent-hq/cloudlands-fe/commit/f90971325eaab60b1ab21b3c2f025b500401d489))


### 🐛 Bug Fixes

* **ci:** pin the Windows release build to windows-2022 ([#920](https://github.com/intent-hq/cloudlands-fe/issues/920)) ([99c2462](https://github.com/intent-hq/cloudlands-fe/commit/99c2462514c0822d397ab2aa4eee6cbdf94042d8))
* **ci:** raise manual Windows build heap cap to 12288 and disable sourcemaps ([#927](https://github.com/intent-hq/cloudlands-fe/issues/927)) ([88357b8](https://github.com/intent-hq/cloudlands-fe/commit/88357b8b8e629dd02ed7a0ae60f7f9e8325cb05b))
* **ci:** raise the Windows release build timeout to 120 minutes ([#923](https://github.com/intent-hq/cloudlands-fe/issues/923)) ([fb58fdc](https://github.com/intent-hq/cloudlands-fe/commit/fb58fdc707706f88cac7e59dd8feb7fd931a985a))
* **ci:** use space-free pnpm dest in the Windows release build ([#916](https://github.com/intent-hq/cloudlands-fe/issues/916)) ([200c6e7](https://github.com/intent-hq/cloudlands-fe/commit/200c6e7f43205234287cf796af456c542035962b))
* **ci:** use System32 bsdtar for the manual Windows build sidecar fetch ([#926](https://github.com/intent-hq/cloudlands-fe/issues/926)) ([f2db91c](https://github.com/intent-hq/cloudlands-fe/commit/f2db91c5ff38349af1bb3339695a03b69bad097d))
* forward macOS swipe gestures to app history navigation ([#858](https://github.com/intent-hq/cloudlands-fe/issues/858)) ([af961e1](https://github.com/intent-hq/cloudlands-fe/commit/af961e180d7605cfe7b11e885433a9906c119f9f))
* include thoughtTokens in stats totalTokens() sum ([#866](https://github.com/intent-hq/cloudlands-fe/issues/866)) ([d8f8dc8](https://github.com/intent-hq/cloudlands-fe/commit/d8f8dc8a3c215c947dce316676694b7419bf81cd))
* initialize auto-updater independent of window-creation timing ([#940](https://github.com/intent-hq/cloudlands-fe/issues/940)) ([ea5db01](https://github.com/intent-hq/cloudlands-fe/commit/ea5db01294185ed01b3178e00d583ab38945611e))
* initialize updater after window creation ([#939](https://github.com/intent-hq/cloudlands-fe/issues/939)) ([e67cfe8](https://github.com/intent-hq/cloudlands-fe/commit/e67cfe899e87e611e8cc16206a1cfef643fd37ed))
* keep deletion tombstone so stale refetches cannot resurrect deleted workspaces ([#932](https://github.com/intent-hq/cloudlands-fe/issues/932)) ([47889de](https://github.com/intent-hq/cloudlands-fe/commit/47889de9fe1bf1a070722dcd3b6ded5c58bbad47))
* prevent NaN-height slide transitions in chat streaming view ([#911](https://github.com/intent-hq/cloudlands-fe/issues/911)) ([1172856](https://github.com/intent-hq/cloudlands-fe/commit/1172856ab6d0fa05ef34643ef707024f3b64027f))
* prevent stale agent hydrate snapshot from regressing a recovered session to error ([#933](https://github.com/intent-hq/cloudlands-fe/issues/933)) ([8d7be11](https://github.com/intent-hq/cloudlands-fe/commit/8d7be114667dbe47cf0d4fb1045325ad46c56845))
* rehydrate queued-messages mirror to clear stale drained rows ([#914](https://github.com/intent-hq/cloudlands-fe/issues/914)) ([ba3173e](https://github.com/intent-hq/cloudlands-fe/commit/ba3173e6c6c8c0c912fb22281f594dc1dda2384c))
* replace startsWith('/') absolute-path checks with isAbsolutePath in tab types ([#867](https://github.com/intent-hq/cloudlands-fe/issues/867)) ([92032ec](https://github.com/intent-hq/cloudlands-fe/commit/92032ec1eec35b9e8fd9f53a2ec22eb0b9ea9f59))
* replace waiting-branch hint with inline branch selector spinner ([#864](https://github.com/intent-hq/cloudlands-fe/issues/864)) ([7f02384](https://github.com/intent-hq/cloudlands-fe/commit/7f02384d1bbeb8f1045eaf7bb1199b2dd26466fc))
* resolve state_referenced_locally warnings and fix stale selector reads ([#919](https://github.com/intent-hq/cloudlands-fe/issues/919)) ([5997aea](https://github.com/intent-hq/cloudlands-fe/commit/5997aeac825aa326ba5675e52eef9af1b3845f99))
* restore boot-time model catalog load into the model slice ([#937](https://github.com/intent-hq/cloudlands-fe/issues/937)) ([af77e8a](https://github.com/intent-hq/cloudlands-fe/commit/af77e8a3fbbd0170d1f418a3d2ad57e63f1203f1))
* restore defaultReasoningEffort hydration and persistence ([#936](https://github.com/intent-hq/cloudlands-fe/issues/936)) ([1d43abd](https://github.com/intent-hq/cloudlands-fe/commit/1d43abde2c087c59c9a6d860d18f7f005dbd7ab1))
* restore Switch To and per-agent agent-failure toasts lost in the saga migration ([#931](https://github.com/intent-hq/cloudlands-fe/issues/931)) ([d018804](https://github.com/intent-hq/cloudlands-fe/commit/d0188042b4fe302046cee5e0a433f48381bcf0ed))
* stabilize footer preview animations in AgentCard and AgentSubscriptions ([#934](https://github.com/intent-hq/cloudlands-fe/issues/934)) ([b20d25e](https://github.com/intent-hq/cloudlands-fe/commit/b20d25e4e007916282a509c599576408bf8b5328))
* surface dismiss-questions failure as an error toast ([#924](https://github.com/intent-hq/cloudlands-fe/issues/924)) ([76deb2e](https://github.com/intent-hq/cloudlands-fe/commit/76deb2e53c485b7a0241fafbf431ac0732a47631))
* surface thoughtTokens in stats passport breakdown and chart segments ([#915](https://github.com/intent-hq/cloudlands-fe/issues/915)) ([e39d0c2](https://github.com/intent-hq/cloudlands-fe/commit/e39d0c211664402b586681ffbd30b9fe24118391))

## [2.21.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.20.0...v2.21.0) (2026-08-09)


### 🚀 Features

* add 60s freshness TTL for mount-driven pr.refresh ([#874](https://github.com/intent-hq/cloudlands-fe/issues/874)) ([17da59a](https://github.com/intent-hq/cloudlands-fe/commit/17da59a5f18a2519b3728b7a74ed566f02cd73c8))
* instant switch-back draft hydration via per-pair cache ([#879](https://github.com/intent-hq/cloudlands-fe/issues/879)) ([d77cbd9](https://github.com/intent-hq/cloudlands-fe/commit/d77cbd9fade564b5717b3df30959de434e8a8cf9))
* move panel-layout history and first-visit state to userData ([#903](https://github.com/intent-hq/cloudlands-fe/issues/903)) ([15c93a9](https://github.com/intent-hq/cloudlands-fe/commit/15c93a927fddc0706a8786ec924ea83f451b148a))
* resolve workspace checkout paths from daemon data only ([#909](https://github.com/intent-hq/cloudlands-fe/issues/909)) ([befa55e](https://github.com/intent-hq/cloudlands-fe/commit/befa55e550370d835233d9e59a33033f964733f1))
* restore external git-change auto-refresh ([#893](https://github.com/intent-hq/cloudlands-fe/issues/893)) ([f3ac5ab](https://github.com/intent-hq/cloudlands-fe/commit/f3ac5aba9a3cd398de9547d5ae85524c415cb195))
* treat PR-monitor-waiting like hook-waiting in idle suppression ([#871](https://github.com/intent-hq/cloudlands-fe/issues/871)) ([95ae10e](https://github.com/intent-hq/cloudlands-fe/commit/95ae10ed4e257d380bb99e460f156e5a8a2be43b))


### 🐛 Bug Fixes

* classify agent-not-found on session load as WARN and clean up stale views ([#906](https://github.com/intent-hq/cloudlands-fe/issues/906)) ([4800014](https://github.com/intent-hq/cloudlands-fe/commit/480001488e5c84ccab36b5c3957cf8e9846a0a8d))
* coalesce reconcileWorkspaceActivity workspace.get refetch per workspace ([#904](https://github.com/intent-hq/cloudlands-fe/issues/904)) ([6a37077](https://github.com/intent-hq/cloudlands-fe/commit/6a370771671e0ea804f357625150286028e49dbe))
* dedupe concurrent accept-changes.getStatus calls ([#875](https://github.com/intent-hq/cloudlands-fe/issues/875)) ([ba62c36](https://github.com/intent-hq/cloudlands-fe/commit/ba62c361fda2cc7ff869ee0eb4007b09cda360c7))
* dedupe monitored PR rows by repo-qualified identity ([#880](https://github.com/intent-hq/cloudlands-fe/issues/880)) ([f0ea382](https://github.com/intent-hq/cloudlands-fe/commit/f0ea3820b8f1dc9e037f812da2b3fb5406408ec7))
* drop per-event workspace.list from live-git-client status refetch ([#896](https://github.com/intent-hq/cloudlands-fe/issues/896)) ([dd35779](https://github.com/intent-hq/cloudlands-fe/commit/dd35779585c19b3ca1f9ab8d80c9263a36d839a5))
* guarantee terminal state for manual update checks (main watchdog session + renderer setCheckTimedOut) ([#882](https://github.com/intent-hq/cloudlands-fe/issues/882)) ([8f19c42](https://github.com/intent-hq/cloudlands-fe/commit/8f19c4299365b10c665cb5d0938b088b77e15786))
* label non-user stream cancellations with accurate reasons ([#907](https://github.com/intent-hq/cloudlands-fe/issues/907)) ([63fc7a1](https://github.com/intent-hq/cloudlands-fe/commit/63fc7a13df2468aa77b9bde46791e8cbed424dd4))
* load Tailwind typography plugin so release notes render as styled markdown ([#908](https://github.com/intent-hq/cloudlands-fe/issues/908)) ([5ed8f65](https://github.com/intent-hq/cloudlands-fe/commit/5ed8f650b489a7609730d50e87482afcae2c2e99))
* make subscribeWorkspaceIds push-driven (no steady-state workspace.list) ([#876](https://github.com/intent-hq/cloudlands-fe/issues/876)) ([1ac9e72](https://github.com/intent-hq/cloudlands-fe/commit/1ac9e724b3c187c3d55b6a0031236013d4022eb0))
* prevent Daemon Status Connection row overflow with long external targets ([94b2322](https://github.com/intent-hq/cloudlands-fe/commit/94b232289050b452b8f935ee409dcc6636cc83ab))
* read workspace agent IDs from agentSummary instead of agent.list fan-out ([c0aee51](https://github.com/intent-hq/cloudlands-fe/commit/c0aee51b9e69670276502aea3318a1bb30c51020))
* read/write quick action model settings under quickActions.* ([#897](https://github.com/intent-hq/cloudlands-fe/issues/897)) ([63b29e5](https://github.com/intent-hq/cloudlands-fe/commit/63b29e5dd667d1a394f2eab82df240c12c884f8f))
* remove legacy refetch mode from createDeltaSubscription ([#881](https://github.com/intent-hq/cloudlands-fe/issues/881)) ([87f0b5e](https://github.com/intent-hq/cloudlands-fe/commit/87f0b5e0f2c9bfb8e9cb4fb30261aee59dafee13))
* restore agent:attention-requested bridge handler ([aefc535](https://github.com/intent-hq/cloudlands-fe/commit/aefc5355e3eb2a698819797370637e1a90672242))
* restore agent:stream:activity handling in the daemon-events bridge ([92fa951](https://github.com/intent-hq/cloudlands-fe/commit/92fa951c9366bbc3333562e0fdfb095d66f4013d))
* restore agent:updated interrupted notify and task:created routing in the events bridge ([#898](https://github.com/intent-hq/cloudlands-fe/issues/898)) ([4efa212](https://github.com/intent-hq/cloudlands-fe/commit/4efa21295fe281e5cb816b04fa3d8131c75d72d0))
* restore chrome-less HUD window layout gating dropped in [#584](https://github.com/intent-hq/cloudlands-fe/issues/584) ([#895](https://github.com/intent-hq/cloudlands-fe/issues/895)) ([0053341](https://github.com/intent-hq/cloudlands-fe/commit/00533410f24d4c1ec920c3d2fabbbc144b2b0df7))
* restore interrupted-agents modal close notify ([#891](https://github.com/intent-hq/cloudlands-fe/issues/891)) ([8f157d6](https://github.com/intent-hq/cloudlands-fe/commit/8f157d685295709d2ba82a94e3c275e34667adeb))
* restore multi-backend localStorage namespacing in persistence sagas ([#899](https://github.com/intent-hq/cloudlands-fe/issues/899)) ([4915bcf](https://github.com/intent-hq/cloudlands-fe/commit/4915bcf91e5c60175c2514f848e48e8672d83fcf))
* restore reconcileWorkspaceAgentSummary in daemon events bridge ([#884](https://github.com/intent-hq/cloudlands-fe/issues/884)) ([8708a66](https://github.com/intent-hq/cloudlands-fe/commit/8708a6674299f6a1d6b018055fab29d53dfecf18))
* restore splash-gate dismissal in +layout.svelte ([#892](https://github.com/intent-hq/cloudlands-fe/issues/892)) ([a4ea363](https://github.com/intent-hq/cloudlands-fe/commit/a4ea363bf85df3d0b4fdedd2451f6e9b42aa579c))
* restore terminal:exit event routing in daemon-events-bridge ([#885](https://github.com/intent-hq/cloudlands-fe/issues/885)) ([34e3e63](https://github.com/intent-hq/cloudlands-fe/commit/34e3e63c1d8e4a89be2ce22132cbd00a75411fac))
* restore workspace:attention-changed handling in daemon events bridge ([#886](https://github.com/intent-hq/cloudlands-fe/issues/886)) ([dd20d66](https://github.com/intent-hq/cloudlands-fe/commit/dd20d668c8cfa0501f4c88bd55c05f12633d5da9))
* route interrupted-agents resume/abandon through the service ([#900](https://github.com/intent-hq/cloudlands-fe/issues/900)) ([aa66a33](https://github.com/intent-hq/cloudlands-fe/commit/aa66a33893b3c996f3cc071a715f0bb73d6ec015))
* send quick-action type and let the daemon resolve the model ([#901](https://github.com/intent-hq/cloudlands-fe/issues/901)) ([50f1333](https://github.com/intent-hq/cloudlands-fe/commit/50f13330b50105250f95412d04c6b63561e1f3ba))
* shared cached listWorkspaceIds + seed-race fix in live-support ([#894](https://github.com/intent-hq/cloudlands-fe/issues/894)) ([c3fb53f](https://github.com/intent-hq/cloudlands-fe/commit/c3fb53f6eac5a9ab4c5eb2ad538f15349fb21e6e))
* single-flight + TTL cache for workspace.list, safer agent.listActive fallback ([#890](https://github.com/intent-hq/cloudlands-fe/issues/890)) ([f2e84fc](https://github.com/intent-hq/cloudlands-fe/commit/f2e84fc7d00b87bc202aa2b33598a9b8e934001f))
* suppress New messages divider for a watched streaming tail ([#883](https://github.com/intent-hq/cloudlands-fe/issues/883)) ([ee47d01](https://github.com/intent-hq/cloudlands-fe/commit/ee47d0151d0d6566ccf9f42e396dcf3c0c8cc60d))

## [2.20.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.19.0...v2.20.0) (2026-08-08)


### 🚀 Features

* gate splash dismissal on backend connected signal ([#846](https://github.com/intent-hq/cloudlands-fe/issues/846)) ([4ab80ba](https://github.com/intent-hq/cloudlands-fe/commit/4ab80ba23c5b6391e1bdddde55f47fe018101254))
* prefer session-advertised effortLevels in the effort picker gate ([#847](https://github.com/intent-hq/cloudlands-fe/issues/847)) ([9db4cb6](https://github.com/intent-hq/cloudlands-fe/commit/9db4cb60fd5d5ffd401ccb4ed99ce61f5c5b9467))


### 🐛 Bug Fixes

* beta-updates toggle desync from actual updater channel (dead real-mode hydration + persistence echo) ([#853](https://github.com/intent-hq/cloudlands-fe/issues/853)) ([b60b456](https://github.com/intent-hq/cloudlands-fe/commit/b60b456ddcf37edb8a01ca3bd1758f5eb9b77d3f))
* bump intentd sidecar pin to 0.6.1 ([a9fd8ac](https://github.com/intent-hq/cloudlands-fe/commit/a9fd8ac142adddbcbe574627486e36f086c650cb))
* Copy local repo tab prefill and Direct checkout-mode pill label ([#849](https://github.com/intent-hq/cloudlands-fe/issues/849)) ([b508f7f](https://github.com/intent-hq/cloudlands-fe/commit/b508f7f4a8893341dd84cef82b441c66b4868623))
* discard pre-clear provider-models cache writes via clear epoch ([#855](https://github.com/intent-hq/cloudlands-fe/issues/855)) ([bf2fc86](https://github.com/intent-hq/cloudlands-fe/commit/bf2fc86abc35323b89d2e315f348c46deba962cd))
* extend waitFor timeout in flaky answer-submission wire test ([#862](https://github.com/intent-hq/cloudlands-fe/issues/862)) ([096dcf1](https://github.com/intent-hq/cloudlands-fe/commit/096dcf12bc4910be50ff45138ce041a9d520b1f8))
* keep provider cards indeterminate on probe failure ([#859](https://github.com/intent-hq/cloudlands-fe/issues/859)) ([709f82a](https://github.com/intent-hq/cloudlands-fe/commit/709f82a3c567a401784d3fe2be22b087baf79dda))
* reconcile Changes tab with git status ([#870](https://github.com/intent-hq/cloudlands-fe/issues/870)) ([d202527](https://github.com/intent-hq/cloudlands-fe/commit/d20252772741c8bd2db935b6f11046a454bf4f66))
* reconnect background-executor quick actions via agent.completeOnce ([#851](https://github.com/intent-hq/cloudlands-fe/issues/851)) ([90e87c6](https://github.com/intent-hq/cloudlands-fe/commit/90e87c6ce746c4aa64bbbf95e91c4fe16e0f319e))
* restore Open In after daemon transport changes ([#869](https://github.com/intent-hq/cloudlands-fe/issues/869)) ([961d666](https://github.com/intent-hq/cloudlands-fe/commit/961d6661b28f7eaa02a02354a033b48798ca9ef3))
* run component tests with the ct-core-aligned playwright runner ([#861](https://github.com/intent-hq/cloudlands-fe/issues/861)) ([51e87de](https://github.com/intent-hq/cloudlands-fe/commit/51e87de7bacaf6f1733463ce6dcc4eed20cd5d67))
* stop fabricating/caching negative provider availability on daemon failure ([#850](https://github.com/intent-hq/cloudlands-fe/issues/850)) ([44363b8](https://github.com/intent-hq/cloudlands-fe/commit/44363b88d93f65d7b9513cebede1ce1da57e88c2))
* unify quick-action settings model sources and surface enhancePrompt gate ([#852](https://github.com/intent-hq/cloudlands-fe/issues/852)) ([250e79c](https://github.com/intent-hq/cloudlands-fe/commit/250e79cf9c6d96e47556c330d59bba44796ba6b6))


### ⚡ Performance

* cache provider model catalogs renderer-side to remove model-picker loading flash ([#848](https://github.com/intent-hq/cloudlands-fe/issues/848)) ([2c7ed84](https://github.com/intent-hq/cloudlands-fe/commit/2c7ed84ef01ee668fe77a04b7370c4bfb8c8fba0))

## [2.19.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.18.0...v2.19.0) (2026-08-07)


### 🚀 Features

* PR monitor settings toggle, per-agent monitored-PRs row, PR-list integration (ws.pr.monitor) ([#842](https://github.com/intent-hq/cloudlands-fe/issues/842)) ([67ee231](https://github.com/intent-hq/cloudlands-fe/commit/67ee2311e18d0fb916d0f078d5429abd5cf4e41d))


### 🐛 Bug Fixes

* override isbinaryfile to ^5.0.7 to fix macOS signing crash ([#843](https://github.com/intent-hq/cloudlands-fe/issues/843)) ([a5c5d9a](https://github.com/intent-hq/cloudlands-fe/commit/a5c5d9ac047c12810bba155e4c96cef76097f06d))

## [2.18.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.17.0...v2.18.0) (2026-08-07)


### 🚀 Features

* add agentFeatures.stateSnapshot settings toggle ([#805](https://github.com/intent-hq/cloudlands-fe/issues/805)) ([f1e93eb](https://github.com/intent-hq/cloudlands-fe/commit/f1e93eb6e782d5d58c28d6be78ab8dbac8c8618d))
* add Waiting section to Active sidebar and focus first unread agent on unread click ([#799](https://github.com/intent-hq/cloudlands-fe/issues/799)) ([8c4ef86](https://github.com/intent-hq/cloudlands-fe/commit/8c4ef86b61065ba62cf95b7bd99e7b6d16f207e1))
* autocomplete GitHub repo suggestions in the RepoSelector "Pick a repo" tab ([#817](https://github.com/intent-hq/cloudlands-fe/issues/817)) ([67c5f8b](https://github.com/intent-hq/cloudlands-fe/commit/67c5f8b4e729297887a069234347f519cd841849))
* connect to remote intentd backends ([#806](https://github.com/intent-hq/cloudlands-fe/issues/806)) ([ad1d005](https://github.com/intent-hq/cloudlands-fe/commit/ad1d005d0334cf22a50b9eb61a85636e63539683))
* cycle content presets from switch-window-layouts hardware action ([#804](https://github.com/intent-hq/cloudlands-fe/issues/804)) ([859111c](https://github.com/intent-hq/cloudlands-fe/commit/859111cc6732e75c1688af700dfb225effe704d6))
* default reasoning effort in All agents settings ([#811](https://github.com/intent-hq/cloudlands-fe/issues/811)) ([79fa75a](https://github.com/intent-hq/cloudlands-fe/commit/79fa75a253daae6cdd3a0f303fd9ef7f39df942d))
* GitHub issue/PR link action menu with new-workspace prefill ([#766](https://github.com/intent-hq/cloudlands-fe/issues/766)) ([995bd37](https://github.com/intent-hq/cloudlands-fe/commit/995bd370c28792a75abed10898671c639ebd17a9))
* **hud:** scroll overflowing takeover banner and extend dwell by the scroll time ([#778](https://github.com/intent-hq/cloudlands-fe/issues/778)) ([c66fb66](https://github.com/intent-hq/cloudlands-fe/commit/c66fb66833becd6a7d63ff47f4ba8850ac9db878))
* **hud:** segmented token bars with thoughts and all-counter burn total ([#825](https://github.com/intent-hq/cloudlands-fe/issues/825)) ([8a8fa55](https://github.com/intent-hq/cloudlands-fe/commit/8a8fa5530ec06a08d6e684a3df701bf47f291294))
* merge vocabulary settings into one Workspace vocabulary section ([#765](https://github.com/intent-hq/cloudlands-fe/issues/765)) ([598f7f8](https://github.com/intent-hq/cloudlands-fe/commit/598f7f87c64d659c6f40a61caefa16ff93d4adf4))
* mirror status-neutral commit policy prompt and rename global auto-commit setting ([#786](https://github.com/intent-hq/cloudlands-fe/issues/786)) ([e0ced7a](https://github.com/intent-hq/cloudlands-fe/commit/e0ced7a6d1f2f5f31f276e72b969d6878a40d3ea))
* navigate history with mouse back/forward buttons ([#777](https://github.com/intent-hq/cloudlands-fe/issues/777)) ([ef6e8c3](https://github.com/intent-hq/cloudlands-fe/commit/ef6e8c3a0dd75a1b49a2b3c9b2c0d081f2c5baa6))
* pick-a-repo tab with recent GitHub repos and cache-hydrated create wiring ([#771](https://github.com/intent-hq/cloudlands-fe/issues/771)) ([dd87184](https://github.com/intent-hq/cloudlands-fe/commit/dd87184c5b846f6bb829e73fb8841b8672ee589a))
* push-apply lastToolUse so footer previews advance during tool calls ([#794](https://github.com/intent-hq/cloudlands-fe/issues/794)) ([e2eaeb0](https://github.com/intent-hq/cloudlands-fe/commit/e2eaeb09a88931d1996372d0f1c5270834e14d14))
* refine HUD token panels (labels, x-axis, 5-min burn trend) ([#809](https://github.com/intent-hq/cloudlands-fe/issues/809)) ([adbbd24](https://github.com/intent-hq/cloudlands-fe/commit/adbbd24d7f43e18e1fe86e51c30e1493c2692307))
* refine multi-backend connect UX and add protocol-compat check ([#823](https://github.com/intent-hq/cloudlands-fe/issues/823)) ([3a041e6](https://github.com/intent-hq/cloudlands-fe/commit/3a041e644fe03ffac323ddb7a75d6e5284992f92))
* remove the inert Auto fetch workspace setting ([#764](https://github.com/intent-hq/cloudlands-fe/issues/764)) ([f043058](https://github.com/intent-hq/cloudlands-fe/commit/f0430581194eed5ced4de037acf78ea7545feb39))
* render task:created rows in the HUD feed ([#822](https://github.com/intent-hq/cloudlands-fe/issues/822)) ([d2de525](https://github.com/intent-hq/cloudlands-fe/commit/d2de5258e0edd9fd8a4ab08a45cae710d9adf815))
* render the canonical BE workspace displayStatus verbatim ([#801](https://github.com/intent-hq/cloudlands-fe/issues/801)) ([14a5fd0](https://github.com/intent-hq/cloudlands-fe/commit/14a5fd0138bb1f2a0c08d8676aca28e67452350c))
* render thinking blocks and surface thoughtTokens usage ([#814](https://github.com/intent-hq/cloudlands-fe/issues/814)) ([ebbea02](https://github.com/intent-hq/cloudlands-fe/commit/ebbea02e89728463daf22de7e5b1893c9310fd85))
* restore last backend on boot, add failure recovery, harden per-backend window state ([#828](https://github.com/intent-hq/cloudlands-fe/issues/828)) ([6b0cc05](https://github.com/intent-hq/cloudlands-fe/commit/6b0cc05e3e1101ec790429b33b2f60aadb386909))
* session plumbing for reasoningEffort ([#772](https://github.com/intent-hq/cloudlands-fe/issues/772)) ([a5ccbec](https://github.com/intent-hq/cloudlands-fe/commit/a5ccbec3f11f13a7c5d94a17c30a0efaa6db67cb))
* show cost column in the token-usage tooltip ([#782](https://github.com/intent-hq/cloudlands-fe/issues/782)) ([efbe6ea](https://github.com/intent-hq/cloudlands-fe/commit/efbe6eabfd535903f6fd316c7d72e0f1e262c3f4))
* show release notes on update and add Help menu entry ([d5933be](https://github.com/intent-hq/cloudlands-fe/commit/d5933bee5fbc894ec327e63e419c0d172b5c20d8))
* show remaining count in HUD pill when cycling unread agents ([#773](https://github.com/intent-hq/cloudlands-fe/issues/773)) ([6da150c](https://github.com/intent-hq/cloudlands-fe/commit/6da150c5bfb3d191f509ac0f5c2239a2b33404bc))
* show tabs for previously running scripts after relaunch ([#770](https://github.com/intent-hq/cloudlands-fe/issues/770)) ([1640eda](https://github.com/intent-hq/cloudlands-fe/commit/1640eda962a1e521a66cb9f73e585d0b43993626))
* tag wizard answers and make pending questions persistent ([#791](https://github.com/intent-hq/cloudlands-fe/issues/791)) ([a6a8368](https://github.com/intent-hq/cloudlands-fe/commit/a6a8368b6f312754af51d66aa94d5011edc76ed4))
* toggle create-workspace modal from hardware new-workspace action ([c8ae073](https://github.com/intent-hq/cloudlands-fe/commit/c8ae073d6afc515c83ef0e55c414bb3fc5d6de42))


### 🐛 Bug Fixes

* add settings action to no-provider toast and wrap modal provider notice ([3ae8359](https://github.com/intent-hq/cloudlands-fe/commit/3ae8359dff0d41116a973ed519044dbbd963c966))
* add spacing around 'and work off' in GitHub clone flow ([#834](https://github.com/intent-hq/cloudlands-fe/issues/834)) ([7d52030](https://github.com/intent-hq/cloudlands-fe/commit/7d520306e40990de3cd8bd3729f713d2e29b1f4c))
* cancel and notify in-flight host.execStream on backend switch ([#815](https://github.com/intent-hq/cloudlands-fe/issues/815)) ([ba1e3c6](https://github.com/intent-hq/cloudlands-fe/commit/ba1e3c6f845e1c3c06087348f599c83f3a0ab095))
* center-align chat input selector buttons ([f3bc99d](https://github.com/intent-hq/cloudlands-fe/commit/f3bc99d79eac574b7ca7737cf001e6e133a8ca6d))
* **chat:** delay draft-gate spinner and lock composer without disabling it ([1083dc0](https://github.com/intent-hq/cloudlands-fe/commit/1083dc0f2b37291b75d47c0d6d97143203b1f8b3))
* confirm running agents before update-install closes the window ([#767](https://github.com/intent-hq/cloudlands-fe/issues/767)) ([4a73178](https://github.com/intent-hq/cloudlands-fe/commit/4a7317814e11f17409bbf2455e84b9c8f8c75ec4))
* correct checkout mode pill tooltip for non-CoW and long notes ([#826](https://github.com/intent-hq/cloudlands-fe/issues/826)) ([22016cc](https://github.com/intent-hq/cloudlands-fe/commit/22016ccf27724d3abc662df61f0820e618cbb4e7))
* derive unread-agent focus from workspace attention ([#800](https://github.com/intent-hq/cloudlands-fe/issues/800)) ([5742182](https://github.com/intent-hq/cloudlands-fe/commit/57421822ecb6ccec76ff9ed8e7eea4843978d6d4))
* drop worktree claim from GitHub-pick clone summary ([#818](https://github.com/intent-hq/cloudlands-fe/issues/818)) ([fe2eb1f](https://github.com/intent-hq/cloudlands-fe/commit/fe2eb1f93879d5fb48d1cdbb0a2c0f34a00c8a55))
* end chief-card divider sessions on chief-card close ([#789](https://github.com/intent-hq/cloudlands-fe/issues/789)) ([0a27e69](https://github.com/intent-hq/cloudlands-fe/commit/0a27e693334286d1b3144e8c4ac590ac5774f38c))
* frame quit dialog by daemon ownership, not connection mode ([#835](https://github.com/intent-hq/cloudlands-fe/issues/835)) ([c50e13b](https://github.com/intent-hq/cloudlands-fe/commit/c50e13b552f543461cd339cc2cf11c25516dbfa4))
* freeze new-messages divider per viewing session and move markSeen to discrete triggers ([8ffbddb](https://github.com/intent-hq/cloudlands-fe/commit/8ffbddb976beafab8d62f27b64feb6ce41ad6d9e))
* guard ChatPanel smooth-scroll rAF loops against unmount ([#775](https://github.com/intent-hq/cloudlands-fe/issues/775)) ([224a2fd](https://github.com/intent-hq/cloudlands-fe/commit/224a2fdc6a2489269464a07967c66107982bf1b1))
* guard DismissibleLayer deferred callbacks ([#808](https://github.com/intent-hq/cloudlands-fe/issues/808)) ([10175a9](https://github.com/intent-hq/cloudlands-fe/commit/10175a9c9694e0c3e085172f7eeda029d0ad7b17))
* handle Windows-absolute and tilde file paths in FileTabType ([167c8f4](https://github.com/intent-hq/cloudlands-fe/commit/167c8f431e1478a9de0e16e1e150b5c8c989c60b))
* isolate dev intentd data dir per DEV_PORT ([8c7470c](https://github.com/intent-hq/cloudlands-fe/commit/8c7470c4c093f7d5372b0cb36035ab73ad6ccf97))
* make footer status indicators reflect live agent activity ([#798](https://github.com/intent-hq/cloudlands-fe/issues/798)) ([6aea481](https://github.com/intent-hq/cloudlands-fe/commit/6aea48128439a6d9f26c0eb09f611cf0df20e3a5))
* make sidebar nav hover card dismissible when panel pin is set ([#769](https://github.com/intent-hq/cloudlands-fe/issues/769)) ([b6a47e0](https://github.com/intent-hq/cloudlands-fe/commit/b6a47e05e3774c922c4dedbba7171ee1397a7921))
* never render raw MCP identifiers as tool labels ([#779](https://github.com/intent-hq/cloudlands-fe/issues/779)) ([40a1255](https://github.com/intent-hq/cloudlands-fe/commit/40a125556031c9041f97621cf0bad6502a5e522c))
* relabel deferred tool-search calls and drop duplicative "Run" verb ([#796](https://github.com/intent-hq/cloudlands-fe/issues/796)) ([68d859f](https://github.com/intent-hq/cloudlands-fe/commit/68d859f1a4243cbba3b91798e0012adc84e54bc6))
* repo picker local-repo labels and last-selection tab restore ([#836](https://github.com/intent-hq/cloudlands-fe/issues/836)) ([055b6ff](https://github.com/intent-hq/cloudlands-fe/commit/055b6ff3dad63f7395bfa9f0f472fa849559aa18))
* restore github repo search side effect after saga removal ([#816](https://github.com/intent-hq/cloudlands-fe/issues/816)) ([6b8c474](https://github.com/intent-hq/cloudlands-fe/commit/6b8c4747cd3b5df9aaf34f9b1dfe82b789b6b327))
* send providerId on agent.setModel wire calls ([#838](https://github.com/intent-hq/cloudlands-fe/issues/838)) ([1556c6c](https://github.com/intent-hq/cloudlands-fe/commit/1556c6c31089c35b1d03b82c15e6d40898ab529c))
* show in-tab warning when opening a file outside the workspace ([#780](https://github.com/intent-hq/cloudlands-fe/issues/780)) ([4d69284](https://github.com/intent-hq/cloudlands-fe/commit/4d6928453f4df1bba749d38affa9a2540429e282))
* show loading spinner instead of missing-model warning while provider models load ([#820](https://github.com/intent-hq/cloudlands-fe/issues/820)) ([86d20b2](https://github.com/intent-hq/cloudlands-fe/commit/86d20b2c66526bcedccca4195ebac3c984ed95b0))
* single-flight git.status refetches in LiveGitClient.subscribe ([#829](https://github.com/intent-hq/cloudlands-fe/issues/829)) ([96576ef](https://github.com/intent-hq/cloudlands-fe/commit/96576ef3424fc4ef8df2bb260f3a4cd2231694d0))
* skip agents-row preset in hardware layout cycle on empty workspace ([#813](https://github.com/intent-hq/cloudlands-fe/issues/813)) ([21c25dc](https://github.com/intent-hq/cloudlands-fe/commit/21c25dcfa4e21ec78d8fb5ec35156f6236013a82))
* stop suggested-prompts parser from capturing response body text ([#792](https://github.com/intent-hq/cloudlands-fe/issues/792)) ([d39caef](https://github.com/intent-hq/cloudlands-fe/commit/d39caef9546d4acfb6e1c485be3e70bbe5cf34d6))
* strip #L line anchor from reference-block filePath so the file opens ([#802](https://github.com/intent-hq/cloudlands-fe/issues/802)) ([185d092](https://github.com/intent-hq/cloudlands-fe/commit/185d092f8c0fc698f899851d916526863954efb8))
* style provider Install links with green primary like Auggie's ([#776](https://github.com/intent-hq/cloudlands-fe/issues/776)) ([16dcbc2](https://github.com/intent-hq/cloudlands-fe/commit/16dcbc2684f875f598ed17ff499cd4624abb696c))
* suppress notify toast when already viewing target workspace ([#833](https://github.com/intent-hq/cloudlands-fe/issues/833)) ([c5493e5](https://github.com/intent-hq/cloudlands-fe/commit/c5493e5f63188cac8d448c0f9e082af517478c14))
* suppress stale codex model warning and add provider notice spacing ([#821](https://github.com/intent-hq/cloudlands-fe/issues/821)) ([cd703cf](https://github.com/intent-hq/cloudlands-fe/commit/cd703cf092b0684795c2ee6f1372b9982c682c82))
* **terminal:** remove black border around xterm output in light mode ([#774](https://github.com/intent-hq/cloudlands-fe/issues/774)) ([70642b9](https://github.com/intent-hq/cloudlands-fe/commit/70642b956f1aec1058f71d239343107037fe5684))
* toast agent-creation failures on fire-and-forget paths ([#781](https://github.com/intent-hq/cloudlands-fe/issues/781)) ([baa2d8d](https://github.com/intent-hq/cloudlands-fe/commit/baa2d8debc02c8c6a8191a83d9903f578db9241d))
* toast workspace-null and note-not-found agent-creation early returns ([#787](https://github.com/intent-hq/cloudlands-fe/issues/787)) ([d58cc4a](https://github.com/intent-hq/cloudlands-fe/commit/d58cc4afedd9a22d52569abeb9038f74e31f1774))
* tolerate slow intentd boot before the watchdog kills it ([d6a1bd9](https://github.com/intent-hq/cloudlands-fe/commit/d6a1bd9a5c60840215831a05e85cbc59b30aa39f))
* widen terminalDisplay verb local to string to unbreak typecheck ([#797](https://github.com/intent-hq/cloudlands-fe/issues/797)) ([8106916](https://github.com/intent-hq/cloudlands-fe/commit/8106916ae8200941cf7cc1bf079b0c308d7db8c4))
* wrap workspace status message while editing ([aae4ae7](https://github.com/intent-hq/cloudlands-fe/commit/aae4ae798b4560b3ed9401c648c4e1989f9eac5a))


### ⚡ Performance

* load provider statuses progressively per provider ([#784](https://github.com/intent-hq/cloudlands-fe/issues/784)) ([137d770](https://github.com/intent-hq/cloudlands-fe/commit/137d7705e493e56cf8b96f63e590f373b8f8ce0d))

## [2.17.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.16.0...v2.17.0) (2026-08-06)


### 🚀 Features

* add informational gh CLI presence probe to onboarding host requirements ([#754](https://github.com/intent-hq/cloudlands-fe/issues/754)) ([9a54323](https://github.com/intent-hq/cloudlands-fe/commit/9a54323974c51fbed8b4e61936d617c184f55a99))
* bulk archive/delete active-work warning parity ([#730](https://github.com/intent-hq/cloudlands-fe/issues/730)) ([a72ff05](https://github.com/intent-hq/cloudlands-fe/commit/a72ff050437206ebd1774e79417beda0f6ca4ff6))
* **chat:** per-conversation seen marker — markSeen trigger + 'New messages' divider ([#748](https://github.com/intent-hq/cloudlands-fe/issues/748)) ([037442a](https://github.com/intent-hq/cloudlands-fe/commit/037442ab837f8430e4a701b3dcbd8a8bc0cc10d4))
* **chat:** reason-specific stopped indicator labels ([#757](https://github.com/intent-hq/cloudlands-fe/issues/757)) ([aa7abe3](https://github.com/intent-hq/cloudlands-fe/commit/aa7abe3f7341ca05de3268fe942de24d8f09a590))
* confirm archive/delete when agents or background hooks are active ([#727](https://github.com/intent-hq/cloudlands-fe/issues/727)) ([e78e397](https://github.com/intent-hq/cloudlands-fe/commit/e78e3973d6216392590c26b9833db35b218cae52))
* defer background model defaults to the provider CLI/daemon ([#761](https://github.com/intent-hq/cloudlands-fe/issues/761)) ([e7b6ab5](https://github.com/intent-hq/cloudlands-fe/commit/e7b6ab524eeb565d69b1d38ec6ec935db32a30d4))
* Finder-like directory picker with sandbox route ([#523](https://github.com/intent-hq/cloudlands-fe/issues/523)) ([dd7a3f7](https://github.com/intent-hq/cloudlands-fe/commit/dd7a3f7e2928a8bf2c79837b61856d063db2b443))
* localize the startup splash text ([#739](https://github.com/intent-hq/cloudlands-fe/issues/739)) ([82c2bf5](https://github.com/intent-hq/cloudlands-fe/commit/82c2bf57fbbe37afffc386d192556db89c0d9fdf))
* match structured voice-no-api-key error code with message-sniff fallback ([#732](https://github.com/intent-hq/cloudlands-fe/issues/732)) ([fafbdfc](https://github.com/intent-hq/cloudlands-fe/commit/fafbdfceefff6cf5fd26b80e35a901c237b11185))
* microphone input-device selector for voice dictation ([#733](https://github.com/intent-hq/cloudlands-fe/issues/733)) ([88eecd9](https://github.com/intent-hq/cloudlands-fe/commit/88eecd93a90683d131c45721a2639f461c163d31))
* model-option rows in specialist settings ([#750](https://github.com/intent-hq/cloudlands-fe/issues/750)) ([f11299b](https://github.com/intent-hq/cloudlands-fe/commit/f11299b686c063bf4fc52dc927d9db42020ef97b))
* open HUD takeover on workspace displayStatus transitions ([#744](https://github.com/intent-hq/cloudlands-fe/issues/744)) ([12dd258](https://github.com/intent-hq/cloudlands-fe/commit/12dd2584b3412cfe12ed9d6c7ba8261f9a0c6bd0))
* show pretty model names with underlying ids in model-change notice ([#734](https://github.com/intent-hq/cloudlands-fe/issues/734)) ([1cded32](https://github.com/intent-hq/cloudlands-fe/commit/1cded32f87a7d19e15047572f596a1f167611bc7))
* **token-usage:** hide all-zero rows from Token usage tooltip ([#756](https://github.com/intent-hq/cloudlands-fe/issues/756)) ([88bcdb3](https://github.com/intent-hq/cloudlands-fe/commit/88bcdb3fb6b2f4400cf3289d0170f8ed18d21297))
* voice dictation language selector wired to the voice.language daemon setting and the macOS engine ([#747](https://github.com/intent-hq/cloudlands-fe/issues/747)) ([860f2d1](https://github.com/intent-hq/cloudlands-fe/commit/860f2d1f6b8da0f66399f8326e1454df0e5fff74))
* **workspace-card:** inline micro key-slot badge + per-slot pastel colors ([#751](https://github.com/intent-hq/cloudlands-fe/issues/751)) ([6f55588](https://github.com/intent-hq/cloudlands-fe/commit/6f55588b6cbd861cd1f2683ae2f0df366a2428c9))
* workspace-derived vocabulary for voice dictation ([#762](https://github.com/intent-hq/cloudlands-fe/issues/762)) ([4116790](https://github.com/intent-hq/cloudlands-fe/commit/41167902f2f600801cd5f76d9ebfc8d6d2887a4e))


### 🐛 Bug Fixes

* add self-healing retry to LiveChatClient.subscribe ([#735](https://github.com/intent-hq/cloudlands-fe/issues/735)) ([3b0993c](https://github.com/intent-hq/cloudlands-fe/commit/3b0993c51b7f57040217614ad5ee95a715b56414))
* derive default model from provider CLI catalog instead of hardcoding ([#759](https://github.com/intent-hq/cloudlands-fe/issues/759)) ([529a1ed](https://github.com/intent-hq/cloudlands-fe/commit/529a1ed4430ef57b518348af39f727e08ec81a8d))
* disable prompt editing and submission while enhancement is in flight ([#741](https://github.com/intent-hq/cloudlands-fe/issues/741)) ([f301b9c](https://github.com/intent-hq/cloudlands-fe/commit/f301b9c90fda9d530fcc31b65a5f9826f4203786))
* fall back to wire preview fields when transcript lacks messages ([#753](https://github.com/intent-hq/cloudlands-fe/issues/753)) ([4015893](https://github.com/intent-hq/cloudlands-fe/commit/40158936081404635f52004dd1125769448de495))
* **hud:** freeze active takeover display and queue same-workspace triggers next ([#752](https://github.com/intent-hq/cloudlands-fe/issues/752)) ([ad9f55c](https://github.com/intent-hq/cloudlands-fe/commit/ad9f55c9e5b6ab525d68acb0783d021f5254448b))
* **hud:** keep event triggers out of pending viewer takeover entries ([#755](https://github.com/intent-hq/cloudlands-fe/issues/755)) ([5ffc62b](https://github.com/intent-hq/cloudlands-fe/commit/5ffc62b9ea5504ba598f7a38ef59d6622817f735))
* **hud:** per-minute token/s chart with Y-scale and truncated attention rows ([#746](https://github.com/intent-hq/cloudlands-fe/issues/746)) ([5dac36b](https://github.com/intent-hq/cloudlands-fe/commit/5dac36b2256e9f42597e79ac256fb34d9152a2c6))
* **hud:** replace takeover halftone headline with Doto dot-matrix font ([#745](https://github.com/intent-hq/cloudlands-fe/issues/745)) ([4fc61da](https://github.com/intent-hq/cloudlands-fe/commit/4fc61da0836d697979c4ebebee3ad4b60b497be9))
* make provider/model selection availability-driven; stop defaulting to Auggie ([#749](https://github.com/intent-hq/cloudlands-fe/issues/749)) ([98214f4](https://github.com/intent-hq/cloudlands-fe/commit/98214f46d9e7504a7e28ccbe6b31546252b4f1dc))
* prevent chat composer draft erasure during restore ([#742](https://github.com/intent-hq/cloudlands-fe/issues/742)) ([c060c26](https://github.com/intent-hq/cloudlands-fe/commit/c060c26230c0d9d91d9b5c2a28bd19019d689593))
* prevent cold-import timeout flake in SidebarChangesPanel tests ([#731](https://github.com/intent-hq/cloudlands-fe/issues/731)) ([6c03753](https://github.com/intent-hq/cloudlands-fe/commit/6c037530ddb0c0e6c46d9c0530d341078ce92385))
* render friendly labels for ToolSearch calls in chat ([#740](https://github.com/intent-hq/cloudlands-fe/issues/740)) ([75508e7](https://github.com/intent-hq/cloudlands-fe/commit/75508e7fce2b11f1b418ac3141262995fb5a6302))
* render structured navigate toast without a resolved key slot ([#743](https://github.com/intent-hq/cloudlands-fe/issues/743)) ([4cd5600](https://github.com/intent-hq/cloudlands-fe/commit/4cd5600771c1ca17afbc73f895a6910d8dbb5b84))
* route dictation to a focused modal dialog instead of the agent composer ([#736](https://github.com/intent-hq/cloudlands-fe/issues/736)) ([1fbe102](https://github.com/intent-hq/cloudlands-fe/commit/1fbe1025f037a2bedec3d7d01d0fe143b704196b))
* **settings:** stop specialist prompt snap-back on blur ([#758](https://github.com/intent-hq/cloudlands-fe/issues/758)) ([976a662](https://github.com/intent-hq/cloudlands-fe/commit/976a662b9e4ccd54265e8eb739991f873f3527f3))
* tear down the whole dev stack when Ctrl-C or app quit ends a long-running member ([#737](https://github.com/intent-hq/cloudlands-fe/issues/737)) ([98fb775](https://github.com/intent-hq/cloudlands-fe/commit/98fb775b72866c9fac8d8e96c819f4f7e6725f6b))
* trigger provider availability check outside onboarding and gate stale catalog rows ([#760](https://github.com/intent-hq/cloudlands-fe/issues/760)) ([5a64275](https://github.com/intent-hq/cloudlands-fe/commit/5a64275506001235e1273b98ad5872807079a899))

## [2.16.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.15.0...v2.16.0) (2026-08-04)


### 🚀 Features

* add Agent Features settings section with new-sessions-only note ([#712](https://github.com/intent-hq/cloudlands-fe/issues/712)) ([328933f](https://github.com/intent-hq/cloudlands-fe/commit/328933f1c88f4d5fb2275df38994e062514a6851))
* add zoom/pan controls to lightboxes and richer mermaid rendering ([#696](https://github.com/intent-hq/cloudlands-fe/issues/696)) ([a293333](https://github.com/intent-hq/cloudlands-fe/commit/a2933331d90a7a951b05b78efb844a9d89ba7774))
* fetch workspace disk usage on demand when the tooltip opens ([#711](https://github.com/intent-hq/cloudlands-fe/issues/711)) ([7f0f58f](https://github.com/intent-hq/cloudlands-fe/commit/7f0f58f024e763e95719089e528dd71b74d7c22d))
* hide non-user entries from the queued-messages section ([#687](https://github.com/intent-hq/cloudlands-fe/issues/687)) ([e63c6e9](https://github.com/intent-hq/cloudlands-fe/commit/e63c6e90ac0920b5f38d4c83e6e15089d4c46eb5))
* include attention-requesting agents in cycle-unread-agents ([#699](https://github.com/intent-hq/cloudlands-fe/issues/699)) ([1853752](https://github.com/intent-hq/cloudlands-fe/commit/18537529f1decfb4b473bd20cdf4653fd4912bb7))
* merge single-agent delegation groups into the one-shot watch section ([#695](https://github.com/intent-hq/cloudlands-fe/issues/695)) ([d72413e](https://github.com/intent-hq/cloudlands-fe/commit/d72413e8d55f92ae22b6f2d716457f52885884f0))
* prioritize unread over running in ambient LED precedence ([#719](https://github.com/intent-hq/cloudlands-fe/issues/719)) ([d64a330](https://github.com/intent-hq/cloudlands-fe/commit/d64a330da2b3d2cfa7afd3acc74640b2ce2ee79c))
* refresh published date on rolling beta and stable releases ([#691](https://github.com/intent-hq/cloudlands-fe/issues/691)) ([481b273](https://github.com/intent-hq/cloudlands-fe/commit/481b273d680d448c56b5e1a3ee2f4c1ed92353cc))
* render questions-dismissed notification as transcript chip + hide queued entry ([#724](https://github.com/intent-hq/cloudlands-fe/issues/724)) ([19c676f](https://github.com/intent-hq/cloudlands-fe/commit/19c676f31df174ab09070bbb4077e7aed3eef112))
* replace flush toggle with queue flush mode dropdown ([#726](https://github.com/intent-hq/cloudlands-fe/issues/726)) ([da1b54e](https://github.com/intent-hq/cloudlands-fe/commit/da1b54eb065dd61acd27809707d3d206a3db78ef))
* restyle workspace finish toast into a three-line layout ([#690](https://github.com/intent-hq/cloudlands-fe/issues/690)) ([500d605](https://github.com/intent-hq/cloudlands-fe/commit/500d605efff0edae9d0f6919a309be8fe78c9da6))
* richer state-driven hardware-console ambient lighting ([#701](https://github.com/intent-hq/cloudlands-fe/issues/701)) ([2ad6861](https://github.com/intent-hq/cloudlands-fe/commit/2ad6861286336df68e1b6e193ffbc885c75a5bac))
* show assigned action icons and tooltips on hardware device graphic ([#706](https://github.com/intent-hq/cloudlands-fe/issues/706)) ([97b35b0](https://github.com/intent-hq/cloudlands-fe/commit/97b35b0b646a7e06d7d1f5ce1855d84f7c9531f0))
* show hook TTL in the hook chip hover card ([#692](https://github.com/intent-hq/cloudlands-fe/issues/692)) ([5fe0260](https://github.com/intent-hq/cloudlands-fe/commit/5fe0260169a974bbdb3801be7121da311f4b02af))
* specialist model inheritance — inherit-by-default picker, reset-all, retire modelTier ([#708](https://github.com/intent-hq/cloudlands-fe/issues/708)) ([beb406a](https://github.com/intent-hq/cloudlands-fe/commit/beb406a5af3b6eb609e93c14ef525f21c829db04))
* suggest unarchiving workspace when chatting in an archived one ([#721](https://github.com/intent-hq/cloudlands-fe/issues/721)) ([8f0fcef](https://github.com/intent-hq/cloudlands-fe/commit/8f0fcef55fbf861948dba7e90870b3ca84c63758))
* voice dictation with push-to-talk, provider settings, and macOS local transcription ([#723](https://github.com/intent-hq/cloudlands-fe/issues/723)) ([49a5297](https://github.com/intent-hq/cloudlands-fe/commit/49a5297c7452b2e4f2f8712e3b4fc9887fb0d33b))


### 🐛 Bug Fixes

* bump intentd sidecar pin to 0.4.2 ([#728](https://github.com/intent-hq/cloudlands-fe/issues/728)) ([12c148d](https://github.com/intent-hq/cloudlands-fe/commit/12c148d8c648b00a9f601e851d3ac4ec99b25f2f))
* clear Modified state when a built-in override matches bundled defaults ([#725](https://github.com/intent-hq/cloudlands-fe/issues/725)) ([384b830](https://github.com/intent-hq/cloudlands-fe/commit/384b830cfe91e8ab9b570f9bddb92d740c76edb9))
* close residual hardware-console lifecycle races in removal rescan and superseded opens ([#718](https://github.com/intent-hq/cloudlands-fe/issues/718)) ([01a8351](https://github.com/intent-hq/cloudlands-fe/commit/01a8351d384864851b55c53504f8d76f7dbe53bf))
* guard hardware console lifecycle against stop/start races ([#716](https://github.com/intent-hq/cloudlands-fe/issues/716)) ([ef02783](https://github.com/intent-hq/cloudlands-fe/commit/ef027833e5646efab036e8dd040d10b12ee0a644))
* hide soft-deleted agents from the subscription UI immediately ([#715](https://github.com/intent-hq/cloudlands-fe/issues/715)) ([2090826](https://github.com/intent-hq/cloudlands-fe/commit/2090826246f04bce8299ec097aa7366c8edf496b))
* infer hardware-console transport from collections and rescan after removal ([#709](https://github.com/intent-hq/cloudlands-fe/issues/709)) ([7a1b803](https://github.com/intent-hq/cloudlands-fe/commit/7a1b803758b8d854cac20256264ae5f860e784b8))
* keep Chief chat subscription alive while workspace chats are viewed ([#707](https://github.com/intent-hq/cloudlands-fe/issues/707)) ([d3e375b](https://github.com/intent-hq/cloudlands-fe/commit/d3e375b2e775e27f4e63d4c50c4d73e95036d12b))
* make scroll-to-previous work under LazyTurn virtualization ([#713](https://github.com/intent-hq/cloudlands-fe/issues/713)) ([c2923e8](https://github.com/intent-hq/cloudlands-fe/commit/c2923e8baac156067005880b9413c56193bf54e9))
* make slot badge non-interactive in settings device graphic ([#702](https://github.com/intent-hq/cloudlands-fe/issues/702)) ([d6771cd](https://github.com/intent-hq/cloudlands-fe/commit/d6771cd867bef2e4cf664593e6eca40060f8ff52))
* move micro-key slot badge to the repo line in workspace sidebar rows ([#698](https://github.com/intent-hq/cloudlands-fe/issues/698)) ([4c72279](https://github.com/intent-hq/cloudlands-fe/commit/4c7227980e5a0387f43b15f2cdb0fda097397495))
* never start hardware console when the integration toggle is off ([#714](https://github.com/intent-hq/cloudlands-fe/issues/714)) ([9c09620](https://github.com/intent-hq/cloudlands-fe/commit/9c09620eb51507eb9aa668bb99cb2d6a5b60dd66))
* never surface previous-turn summaries while the agent is responding ([#722](https://github.com/intent-hq/cloudlands-fe/issues/722)) ([ae30f3f](https://github.com/intent-hq/cloudlands-fe/commit/ae30f3f07084bf5a2e50cb0d648a77ce63c90b74))
* preserve composer draft when selecting a suggested prompt ([#697](https://github.com/intent-hq/cloudlands-fe/issues/697)) ([5287906](https://github.com/intent-hq/cloudlands-fe/commit/52879060aac8060443ee683db14be08656bde9c9))
* remove divider between consecutively dequeued queued messages ([#717](https://github.com/intent-hq/cloudlands-fe/issues/717)) ([aaebe5b](https://github.com/intent-hq/cloudlands-fe/commit/aaebe5b0a9c0bdf9180a0432c589cab41be2195a))
* replace native selects with the custom portaled Select component ([#694](https://github.com/intent-hq/cloudlands-fe/issues/694)) ([80ee1d3](https://github.com/intent-hq/cloudlands-fe/commit/80ee1d37b044521ad48ea9a556f05c917bbef3eb))
* restore system font list fetch in user-preferences hydration ([#693](https://github.com/intent-hq/cloudlands-fe/issues/693)) ([d3753b5](https://github.com/intent-hq/cloudlands-fe/commit/d3753b50285ebaf7a1bf0a67c16f271026e2ab7b))
* restore terminal panel and tabs across workspace switches ([#705](https://github.com/intent-hq/cloudlands-fe/issues/705)) ([7c365fb](https://github.com/intent-hq/cloudlands-fe/commit/7c365fb20197027147f9905c9c59d8725b51257d))
* reword one-shot watch footer header to distributive waiting-on phrasing ([#720](https://github.com/intent-hq/cloudlands-fe/issues/720)) ([1d5eac6](https://github.com/intent-hq/cloudlands-fe/commit/1d5eac61f9de5f61123bfe7b3a9044a8781209b6))
* share a single backend:status listener across onReconnected subscribers ([#710](https://github.com/intent-hq/cloudlands-fe/issues/710)) ([a880c66](https://github.com/intent-hq/cloudlands-fe/commit/a880c6626814552597c2d268925465fa6d45d7b5))
* show HUD unread state over complete and pr_merged, sourced from daemon attention ([#703](https://github.com/intent-hq/cloudlands-fe/issues/703)) ([7bf2b4f](https://github.com/intent-hq/cloudlands-fe/commit/7bf2b4f908a4832bfc69b5c87c9ff8a874d5f52a))
* stable alphabetical provider list order in settings ([#704](https://github.com/intent-hq/cloudlands-fe/issues/704)) ([bab2d16](https://github.com/intent-hq/cloudlands-fe/commit/bab2d16b50bc3600e64a4e06d7c2bc3ff095334f))
* stop active-stream and agents-seeder boot fan-outs ([#686](https://github.com/intent-hq/cloudlands-fe/issues/686)) ([2a626b2](https://github.com/intent-hq/cloudlands-fe/commit/2a626b28d93d5a6b332fd6748e81d3cc7d53fb64))

## [2.15.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.14.0...v2.15.0) (2026-08-03)


### 🚀 Features

* add flush queued messages toggle to agent settings ([#678](https://github.com/intent-hq/cloudlands-fe/issues/678)) ([f1a112a](https://github.com/intent-hq/cloudlands-fe/commit/f1a112a92af49b9e5dce3a405227dd0a5ac4c87b))
* clear hardware-console lighting on app shutdown ([#677](https://github.com/intent-hq/cloudlands-fe/issues/677)) ([04d5a97](https://github.com/intent-hq/cloudlands-fe/commit/04d5a97742309421c9c1a77d85fbb7efdbb87258))
* hardware-console cycling, toast badges, hook-aware LEDs, cycle HUD, CM2 defaults ([#679](https://github.com/intent-hq/cloudlands-fe/issues/679)) ([8102f26](https://github.com/intent-hq/cloudlands-fe/commit/8102f26bb4e40bfd29718f8edefc523ee3c1cd7b))


### 🐛 Bug Fixes

* bump intentd sidecar pin to 0.4.1 ([#684](https://github.com/intent-hq/cloudlands-fe/issues/684)) ([e6e318a](https://github.com/intent-hq/cloudlands-fe/commit/e6e318a3406427aab70a04e20aaa63ef164eb0d0))
* chat rich-block affordances (nav-link, mermaid lightbox, CLI copy, reference open) ([#675](https://github.com/intent-hq/cloudlands-fe/issues/675)) ([299995c](https://github.com/intent-hq/cloudlands-fe/commit/299995cb36ed124b19da9ed6b2801f0105f643f3))
* drive workspace unread indicators from daemon attention flag ([#680](https://github.com/intent-hq/cloudlands-fe/issues/680)) ([bc14f73](https://github.com/intent-hq/cloudlands-fe/commit/bc14f73539f6613c26d76d3a3763d8f665d7ee12))
* HUD failed-card errors, sidebar blink gating, /hud nav guard, deleted-agent refresh ([#676](https://github.com/intent-hq/cloudlands-fe/issues/676)) ([6b7a9b0](https://github.com/intent-hq/cloudlands-fe/commit/6b7a9b095124c7b6f0129f756c5ad5e2800c321d))
* hydrate unknown agent sessions on stream events for live footer previews ([#682](https://github.com/intent-hq/cloudlands-fe/issues/682)) ([16e348c](https://github.com/intent-hq/cloudlands-fe/commit/16e348ce1efbe8accf58b0efaee28dd8446fdea0))
* make the HUD window inert to hardware-console input ([#681](https://github.com/intent-hq/cloudlands-fe/issues/681)) ([6810a3f](https://github.com/intent-hq/cloudlands-fe/commit/6810a3fd42542976d088e31707ac240ce7528ed6))


### ⚡ Performance

* speed up dev startup with warm vite cache, incremental tsc, and overlapped builds ([#672](https://github.com/intent-hq/cloudlands-fe/issues/672)) ([c406696](https://github.com/intent-hq/cloudlands-fe/commit/c4066969db9045f559c1074c6e292d061f40d791))

## [2.14.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.13.0...v2.14.0) (2026-08-03)


### 🚀 Features

* add New Folder to the remote directory browser ([#660](https://github.com/intent-hq/cloudlands-fe/issues/660)) ([c84d4ae](https://github.com/intent-hq/cloudlands-fe/commit/c84d4ae5ac44e65b8773f1ff9937c28bb8b6aa0e))
* connect to the intentd daemon via named pipe on win32 ([#650](https://github.com/intent-hq/cloudlands-fe/issues/650)) ([acbb040](https://github.com/intent-hq/cloudlands-fe/commit/acbb0408d2c6d5703e0e62c00a75d8f15636e774))
* Fleet HUD v3 — pop-out fleet ops window, data layer, grid, takeover overlay, and live-feedback hardening ([#659](https://github.com/intent-hq/cloudlands-fe/issues/659)) ([c38ca9f](https://github.com/intent-hq/cloudlands-fe/commit/c38ca9fc8836309c1d2b072a97728cfc7be70926))
* hardware console post-ship fixes and UX refinements ([#661](https://github.com/intent-hq/cloudlands-fe/issues/661)) ([c4a70de](https://github.com/intent-hq/cloudlands-fe/commit/c4a70de0f0f114e2de7d205a20defdccb491d216))
* hook script viewer modal with script and last-run logs tabs ([#648](https://github.com/intent-hq/cloudlands-fe/issues/648)) ([cb5daee](https://github.com/intent-hq/cloudlands-fe/commit/cb5daee651d994771584fafdf3e37aa5be7276d6))
* settings path fields use OS/remote pickers instead of free-text ([#658](https://github.com/intent-hq/cloudlands-fe/issues/658)) ([d82fd92](https://github.com/intent-hq/cloudlands-fe/commit/d82fd92675b98c07620af73ee3d9e413f566a604))


### 🐛 Bug Fixes

* bump bundled intentd sidecar to 0.4.0 ([#673](https://github.com/intent-hq/cloudlands-fe/issues/673)) ([9fb3edd](https://github.com/intent-hq/cloudlands-fe/commit/9fb3edd1b8e9225f6bcd2152001e12ce88e2d16c))
* **ci:** gate sourcemaps on mac/win release legs and raise heap cap to 12288 ([#644](https://github.com/intent-hq/cloudlands-fe/issues/644)) ([63477cd](https://github.com/intent-hq/cloudlands-fe/commit/63477cd44da4d60f6c7f9c368f59311d919ecc7e))
* **ci:** per-arch heap caps on Linux release legs (x64 hosted runner OOM) ([cde6141](https://github.com/intent-hq/cloudlands-fe/commit/cde6141010a19ca46daa7e0dd1ba6b5fd0272709))
* **ci:** raise Linux x64 release heap cap to 10240 (boundary-flaky at 8192) ([0f1ca6f](https://github.com/intent-hq/cloudlands-fe/commit/0f1ca6f6fa6c258453c8259f2a6213dc01ada6e1))
* **ci:** route release Linux x64 to self-hosted tinybox and mac to macos-latest ([#649](https://github.com/intent-hq/cloudlands-fe/issues/649)) ([f410182](https://github.com/intent-hq/cloudlands-fe/commit/f410182610655c51ed274b20921ff1a7e763d559))
* converge terminal tabs to zero on authoritative same-boot empty list ([#656](https://github.com/intent-hq/cloudlands-fe/issues/656)) ([bb300ee](https://github.com/intent-hq/cloudlands-fe/commit/bb300ee0588ee4942cfc92c35104fc25ba2fed35))
* guard scriptsClient.update against running scripts ([#655](https://github.com/intent-hq/cloudlands-fe/issues/655)) ([eef830b](https://github.com/intent-hq/cloudlands-fe/commit/eef830bf4975cdf327c94be7b4749993b30d7170))
* never remove or update running scripts during detect ([#654](https://github.com/intent-hq/cloudlands-fe/issues/654)) ([1f2b852](https://github.com/intent-hq/cloudlands-fe/commit/1f2b852f29af1a5b8149ec79f9058e34e0fd4d1d))
* normalize dot-separated MCP tool names in tool classifier ([#669](https://github.com/intent-hq/cloudlands-fe/issues/669)) ([c28e4e7](https://github.com/intent-hq/cloudlands-fe/commit/c28e4e7e91f281b745d150e3a360692c8142efc1))
* restore notification click navigation via in-app toast when frontmost ([#657](https://github.com/intent-hq/cloudlands-fe/issues/657)) ([59ce5ea](https://github.com/intent-hq/cloudlands-fe/commit/59ce5ea5efdbedb19df993e7e124d1293223e106))
* route path-like chat links to the workspace file viewer instead of the browser panel ([#670](https://github.com/intent-hq/cloudlands-fe/issues/670)) ([5752cf6](https://github.com/intent-hq/cloudlands-fe/commit/5752cf6f7f04b3b2c33521024c7311372ecf0077))
* **scripts:** broaden detect upsert guard to all live script statuses ([#653](https://github.com/intent-hq/cloudlands-fe/issues/653)) ([e511c78](https://github.com/intent-hq/cloudlands-fe/commit/e511c78d36131ddfd34b1059dcf23943a069ec10))
* send image-only messages instead of silently dropping them ([#671](https://github.com/intent-hq/cloudlands-fe/issues/671)) ([a830d61](https://github.com/intent-hq/cloudlands-fe/commit/a830d610fa1c4cbc3ad5cd5906dcad59b3c45156))

## [2.13.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.12.0...v2.13.0) (2026-08-02)


### 🚀 Features

* background hooks row above chat input ([#626](https://github.com/intent-hq/cloudlands-fe/issues/626)) ([f132b68](https://github.com/intent-hq/cloudlands-fe/commit/f132b68b3c3b73d8befb033135bcd699b7e038e6))
* confirm before dismissing agent questions, rename Ignore to Hide ([#639](https://github.com/intent-hq/cloudlands-fe/issues/639)) ([10cffa6](https://github.com/intent-hq/cloudlands-fe/commit/10cffa6234ba91faa0c93c27c1ec439b3d7539d1))
* consume daemon-resolved model fields, drop client-side model resolution ([#633](https://github.com/intent-hq/cloudlands-fe/issues/633)) ([4ab9fdf](https://github.com/intent-hq/cloudlands-fe/commit/4ab9fdfb520a2db008166256270afdd9525c58b4))
* gate enhance prompt and AI layout on the auggie provider ([#624](https://github.com/intent-hq/cloudlands-fe/issues/624)) ([19c606f](https://github.com/intent-hq/cloudlands-fe/commit/19c606f1716f3437d817b0053a7bfb146e03d266))
* move WebSocket API section to General settings tab ([#635](https://github.com/intent-hq/cloudlands-fe/issues/635)) ([105e299](https://github.com/intent-hq/cloudlands-fe/commit/105e299462697958f08473b7a3beea01cccede98))
* onboarding model selector + silent repo-config setup script default ([#623](https://github.com/intent-hq/cloudlands-fe/issues/623)) ([7a39e69](https://github.com/intent-hq/cloudlands-fe/commit/7a39e69867ea18d7ad4a36b6c5e284b7d0c22b75))
* show workspace disk usage in the workspace card subtitle ([#627](https://github.com/intent-hq/cloudlands-fe/issues/627)) ([bdc8d97](https://github.com/intent-hq/cloudlands-fe/commit/bdc8d97aef6710e20dd96ffda86817b96e461cc8))
* staged live-stream hydration phase indicator in chat panel ([#632](https://github.com/intent-hq/cloudlands-fe/issues/632)) ([1767abc](https://github.com/intent-hq/cloudlands-fe/commit/1767abcd0cc1353ce3bd2a0bea4d0b99c315dd45))
* transcript search in the command palette with deep-open to message ([#622](https://github.com/intent-hq/cloudlands-fe/issues/622)) ([f0c6d0a](https://github.com/intent-hq/cloudlands-fe/commit/f0c6d0a31fa2ac20d055f4e1868cfb92a1885d56))
* Work Louder Creator Micro 2 / Codex Micro hardware console ([#642](https://github.com/intent-hq/cloudlands-fe/issues/642)) ([21e5a07](https://github.com/intent-hq/cloudlands-fe/commit/21e5a07c2592fc374887161c9caa145e07ae0967))


### 🐛 Bug Fixes

* align response group header preview snippet to the name baseline ([#638](https://github.com/intent-hq/cloudlands-fe/issues/638)) ([c9c4c46](https://github.com/intent-hq/cloudlands-fe/commit/c9c4c4654ee4f3894bad40fa81b07fba26309486))
* disk-usage pill font size, tooltip indentation, and subtitle separator ([#628](https://github.com/intent-hq/cloudlands-fe/issues/628)) ([4d344f9](https://github.com/intent-hq/cloudlands-fe/commit/4d344f94b2ab4502529e932f6a0e295a985e3428))
* guard detect-flow upsert against killing a running script ([#630](https://github.com/intent-hq/cloudlands-fe/issues/630)) ([07e9a1f](https://github.com/intent-hq/cloudlands-fe/commit/07e9a1fa9a1cc5d93f1b69c6f726ab3fc78a65ff))
* keep last/streaming response group semi-open on collapse ([#637](https://github.com/intent-hq/cloudlands-fe/issues/637)) ([dd5e68e](https://github.com/intent-hq/cloudlands-fe/commit/dd5e68efb9736309d03034ae68e0b9e0c28006a8))
* let this-turn live text outrank stale previous-turn digest in AgentCard preview ([#636](https://github.com/intent-hq/cloudlands-fe/issues/636)) ([49d19af](https://github.com/intent-hq/cloudlands-fe/commit/49d19af746ded9d3998889e247d8b5ef37404f25))
* **main:** bound gracefulShutdown with a 10s hard-exit watchdog ([#625](https://github.com/intent-hq/cloudlands-fe/issues/625)) ([758fe6f](https://github.com/intent-hq/cloudlands-fe/commit/758fe6f8caecfe27c58c03e1314d0272de2ade9b))
* move lastUpdated timestamp into systemStatusSuccess action payload ([#618](https://github.com/intent-hq/cloudlands-fe/issues/618)) ([808d6df](https://github.com/intent-hq/cloudlands-fe/commit/808d6df16fb9ca8c237ef98fcf624fbefd26a198))
* preserve terminals and scripts across workspace switches ([#640](https://github.com/intent-hq/cloudlands-fe/issues/640)) ([ec1f2f0](https://github.com/intent-hq/cloudlands-fe/commit/ec1f2f048548b6ecc3a5f9357552c8a48f5422c4))
* raise backend:status IPC listener cap to 15 in preload ([#631](https://github.com/intent-hq/cloudlands-fe/issues/631)) ([74b0f85](https://github.com/intent-hq/cloudlands-fe/commit/74b0f859f62e7da67db0bd2d0a2493da2316c9ca))
* use readable destructive token for Q&A dismiss controls ([#641](https://github.com/intent-hq/cloudlands-fe/issues/641)) ([0d56fe3](https://github.com/intent-hq/cloudlands-fe/commit/0d56fe3f49b8977b0ce3a8398a945723d4a071b9))

## [2.12.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.11.0...v2.12.0) (2026-08-01)


### 🚀 Features

* add waiting-for header to one-shot watch rows in agent subscription footer ([#596](https://github.com/intent-hq/cloudlands-fe/issues/596)) ([8424349](https://github.com/intent-hq/cloudlands-fe/commit/84243493384df90baa89a71dbadf2aedab4e39d1))
* add Windows and Linux release builds ([#599](https://github.com/intent-hq/cloudlands-fe/issues/599)) ([3c7695f](https://github.com/intent-hq/cloudlands-fe/commit/3c7695ff5b132abbea0f6fc74af80ec135410bf8))
* add Workspace API output settings section ([#604](https://github.com/intent-hq/cloudlands-fe/issues/604)) ([3a28850](https://github.com/intent-hq/cloudlands-fe/commit/3a28850295edd5e218305b7a570d0436355df6e6))
* notify fixed monorepo issues on beta release and stable promotion ([#598](https://github.com/intent-hq/cloudlands-fe/issues/598)) ([6e705dc](https://github.com/intent-hq/cloudlands-fe/commit/6e705dc6640eb82075e671d99a1964985fbedabd))
* render dequeue-wait chip from queueInfo message metadata ([#611](https://github.com/intent-hq/cloudlands-fe/issues/611)) ([2991023](https://github.com/intent-hq/cloudlands-fe/commit/299102369319bf835b5738cd6950fc7ae9ec11a2))
* render needs_attention workspace displayStatus ([#610](https://github.com/intent-hq/cloudlands-fe/issues/610)) ([932ba09](https://github.com/intent-hq/cloudlands-fe/commit/932ba09a18de070168dfdb9a873bf335e8860a62))
* suppress redundant aggregate file-changes row in chat ([#592](https://github.com/intent-hq/cloudlands-fe/issues/592)) ([475c376](https://github.com/intent-hq/cloudlands-fe/commit/475c376edacb3636984cadc48983aacffd7f206a))
* turn-failure notice card and live attention timestamps ([#593](https://github.com/intent-hq/cloudlands-fe/issues/593)) ([246fcb6](https://github.com/intent-hq/cloudlands-fe/commit/246fcb6bd0679821ac605a222abba0a5569dfe89))


### 🐛 Bug Fixes

* bump bundled intentd sidecar to 0.2.16 ([#612](https://github.com/intent-hq/cloudlands-fe/issues/612)) ([fcc27af](https://github.com/intent-hq/cloudlands-fe/commit/fcc27af4d45939aba47b32d2283eac78959f584a))
* clear stale runtime flags on authoritative-idle hydration (intent-hq/monorepo[#1250](https://github.com/intent-hq/cloudlands-fe/issues/1250)) ([#606](https://github.com/intent-hq/cloudlands-fe/issues/606)) ([4b91486](https://github.com/intent-hq/cloudlands-fe/commit/4b9148664c0b430ebe85b34825f8281c4114ab12))
* enforce option/Other exclusivity for single-select Q&A questions ([#602](https://github.com/intent-hq/cloudlands-fe/issues/602)) ([544c8c8](https://github.com/intent-hq/cloudlands-fe/commit/544c8c89795187356fb5ce4eebf69b89cb5b3a53))
* evict stale stream-owned ghost messages on hydrate (intent-hq/monorepo[#1160](https://github.com/intent-hq/cloudlands-fe/issues/1160)) ([#600](https://github.com/intent-hq/cloudlands-fe/issues/600)) ([02077b1](https://github.com/intent-hq/cloudlands-fe/commit/02077b191919d6f846baff0fac6f3c2ef2bf643b))
* exclude non-file tool calls from conversation file changes (monorepo[#1245](https://github.com/intent-hq/cloudlands-fe/issues/1245)) ([#601](https://github.com/intent-hq/cloudlands-fe/issues/601)) ([42e551b](https://github.com/intent-hq/cloudlands-fe/commit/42e551b01b6181d742b74b8c3aa54cca0a74c4c3))
* include completionReport and mutable metadata fields in session no-op guard snapshot (intent-hq/monorepo[#1231](https://github.com/intent-hq/cloudlands-fe/issues/1231)) ([#594](https://github.com/intent-hq/cloudlands-fe/issues/594)) ([7f04c17](https://github.com/intent-hq/cloudlands-fe/commit/7f04c17b724d5d84ee070104fb848a0325e2d5da))
* remove Quake terminal tabs on terminal:exit ([#551](https://github.com/intent-hq/cloudlands-fe/issues/551)) ([67b8a4b](https://github.com/intent-hq/cloudlands-fe/commit/67b8a4b33ba1aec0fdc2898484ebd17b8c29341a))
* round live elapsed 'ago' timer to whole seconds ([#603](https://github.com/intent-hq/cloudlands-fe/issues/603)) ([237825f](https://github.com/intent-hq/cloudlands-fe/commit/237825f40774e20e52359a0a6343ae1ea3f35cfe))
* stack attention request banner header above reason ([cf93299](https://github.com/intent-hq/cloudlands-fe/commit/cf93299d5af0b29b4f29929d128fddcde5959ae6))

## [2.11.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.10.2...v2.11.0) (2026-08-01)


### 🚀 Features

* add Dismiss to the question wizard honoring the daemon dismissal marker ([#561](https://github.com/intent-hq/cloudlands-fe/issues/561)) ([f7678b6](https://github.com/intent-hq/cloudlands-fe/commit/f7678b66861159d433498c6cac50707a5280461f))
* consume content-free agent:stream:activity instead of agent:stream:chunk ([#568](https://github.com/intent-hq/cloudlands-fe/issues/568)) ([13c713a](https://github.com/intent-hq/cloudlands-fe/commit/13c713a2aaa04caffdba8b7c548195ac8af62b00))
* dedupe agent idle notifications via native identifiers ([#572](https://github.com/intent-hq/cloudlands-fe/issues/572)) ([28c8d93](https://github.com/intent-hq/cloudlands-fe/commit/28c8d93308da0dad7e6cf617befa4a5ed31f87d9))
* live watched-agent footer previews via agent:stream:activity payloads ([#579](https://github.com/intent-hq/cloudlands-fe/issues/579)) ([a4cacc0](https://github.com/intent-hq/cloudlands-fe/commit/a4cacc09d5a91355f3390d68e6c63403024913f7))
* migrate live transcript to chat.subscribe deltas ([#559](https://github.com/intent-hq/cloudlands-fe/issues/559)) ([f5da91b](https://github.com/intent-hq/cloudlands-fe/commit/f5da91bd241f6eca4775485da1738e182da513a7))
* per-row and per-group stop/cancel actions in the subscriptions footer ([744491f](https://github.com/intent-hq/cloudlands-fe/commit/744491f872ecdd6c337bb83ab8cd12053998b6a8))
* prefer appMessageId matching on the chat.subscribe delta path ([#576](https://github.com/intent-hq/cloudlands-fe/issues/576)) ([5f6a0a4](https://github.com/intent-hq/cloudlands-fe/commit/5f6a0a4954cbe27df0d94f3c9bf48815f1020681))
* prefer the user's newest message in agent card previews ([#586](https://github.com/intent-hq/cloudlands-fe/issues/586)) ([c4edb27](https://github.com/intent-hq/cloudlands-fe/commit/c4edb27e70cff37c491447aa95ba08a3ee6e51f3))
* render BE displayStatus verbatim, drop FE grouping demotion/promotion ([#578](https://github.com/intent-hq/cloudlands-fe/issues/578)) ([a80626c](https://github.com/intent-hq/cloudlands-fe/commit/a80626c6d2703843f1380b6ca1e8e74787acf6ac))
* settings-backed workspace setup (retry-safe app settings, daemon-backed auto-commit toggle) ([#550](https://github.com/intent-hq/cloudlands-fe/issues/550)) ([381100e](https://github.com/intent-hq/cloudlands-fe/commit/381100e08aa11833b9a318e772f35af449b4af55))
* show intentd UDS socket path in Settings &gt; General ([#574](https://github.com/intent-hq/cloudlands-fe/issues/574)) ([cbca646](https://github.com/intent-hq/cloudlands-fe/commit/cbca64692cd58da2ce02e5d610f937685f9afe64))
* show queue visibility and held-messages hint around the Q&A wizard ([#566](https://github.com/intent-hq/cloudlands-fe/issues/566)) ([cda1d62](https://github.com/intent-hq/cloudlands-fe/commit/cda1d6238c103f7115a84ff9e240799c2486c96b))
* skip attention and failure toasts for delegated agents (parentAgentId) ([#573](https://github.com/intent-hq/cloudlands-fe/issues/573)) ([75f7b04](https://github.com/intent-hq/cloudlands-fe/commit/75f7b0447dfa7e5c935c5dd7aff3c2b1eeefce5f))
* surface agent attention requests (blocked status, notices, sticky toast, indicators) ([#558](https://github.com/intent-hq/cloudlands-fe/issues/558)) ([eebf778](https://github.com/intent-hq/cloudlands-fe/commit/eebf778ca4af60b98df2e7f82670ae6a983c8631))
* ungroup agent-failure toasts and add a Switch To button ([#555](https://github.com/intent-hq/cloudlands-fe/issues/555)) ([f454519](https://github.com/intent-hq/cloudlands-fe/commit/f4545195fcd0e63dee23d943eb4e843ea2a8a2b1))


### 🐛 Bug Fixes

* apply entity-level metadata in live reconciler so agent chips render live ([#564](https://github.com/intent-hq/cloudlands-fe/issues/564)) ([4622f7e](https://github.com/intent-hq/cloudlands-fe/commit/4622f7e50e4fb89abec563da047bc72fe87d6a79))
* clear stale error banner when a daemon-side redrive turn starts (intent-hq/monorepo[#1106](https://github.com/intent-hq/cloudlands-fe/issues/1106)) ([#549](https://github.com/intent-hq/cloudlands-fe/issues/549)) ([dfd9e10](https://github.com/intent-hq/cloudlands-fe/commit/dfd9e1041fb7b5570258b2999c291e802ca8ddc4))
* dedup user-row echoes and preserve in-flight stream on re-entry (post-[#559](https://github.com/intent-hq/cloudlands-fe/issues/559) P0s) ([#565](https://github.com/intent-hq/cloudlands-fe/issues/565)) ([e3b38a3](https://github.com/intent-hq/cloudlands-fe/commit/e3b38a3b42448a4799400df091defde11936328c))
* let attention-request reason wrap to multiple lines ([#563](https://github.com/intent-hq/cloudlands-fe/issues/563)) ([d524b63](https://github.com/intent-hq/cloudlands-fe/commit/d524b6331efd36cd63589d3584f68da379ca796f))
* normalize diff request paths to worktree-relative in diff-ipc-batcher ([#577](https://github.com/intent-hq/cloudlands-fe/issues/577)) ([01ac0a7](https://github.com/intent-hq/cloudlands-fe/commit/01ac0a7ceb3e343e65175ba6a740fd30310cbdaf))
* preserve single line breaks in chat input serialization ([2eee6c4](https://github.com/intent-hq/cloudlands-fe/commit/2eee6c40b19f22257e1fc496d11da653a3d2364c))
* re-apply reconciler transcript on hydrate settle (monorepo[#1161](https://github.com/intent-hq/cloudlands-fe/issues/1161)) ([#582](https://github.com/intent-hq/cloudlands-fe/issues/582)) ([0b73fcd](https://github.com/intent-hq/cloudlands-fe/commit/0b73fcd39b3817a1b55047b7a2310f6e173e8a9a))
* render harmless inline tags (br/sub/sup) in chat markdown ([#556](https://github.com/intent-hq/cloudlands-fe/issues/556)) ([a9dc8f5](https://github.com/intent-hq/cloudlands-fe/commit/a9dc8f535771298c9920bbea87fd4629f6784c2c))
* restore chat-changes and local-changes tab opening in navigation middleware ([#569](https://github.com/intent-hq/cloudlands-fe/issues/569)) ([c57c62e](https://github.com/intent-hq/cloudlands-fe/commit/c57c62e405ac81fbd30c420644a246003b9dd547))
* scope clearCurrentlyViewedAgent so a background panel cannot kill the viewed chat's subscription ([#583](https://github.com/intent-hq/cloudlands-fe/issues/583)) ([788acfc](https://github.com/intent-hq/cloudlands-fe/commit/788acfc31133b82d5c97963386b8b25082d909b8))

## [2.10.2](https://github.com/intent-hq/cloudlands-fe/compare/v2.10.1...v2.10.2) (2026-07-29)


### 🐛 Bug Fixes

* bump intentd sidecar pin to 0.2.14 ([#544](https://github.com/intent-hq/cloudlands-fe/issues/544)) ([a7841c3](https://github.com/intent-hq/cloudlands-fe/commit/a7841c304bab5401a056239d56dcf5e77ecaa074))
* programmatically focus context-picker search input when panel opens ([#545](https://github.com/intent-hq/cloudlands-fe/issues/545)) ([2676acb](https://github.com/intent-hq/cloudlands-fe/commit/2676acb2eeae1ebbd65f94099424ac041c0da6e0))
* recover mis-normalized paths in diff batcher after paths[] narrowing (intent-hq/monorepo[#1079](https://github.com/intent-hq/cloudlands-fe/issues/1079)) ([#546](https://github.com/intent-hq/cloudlands-fe/issues/546)) ([9cf8e8d](https://github.com/intent-hq/cloudlands-fe/commit/9cf8e8d9e244e2640d7fe2614511e3bed54bbf04))

## [2.10.1](https://github.com/intent-hq/cloudlands-fe/compare/v2.10.0...v2.10.1) (2026-07-29)


### 🐛 Bug Fixes

* **ci:** skip sourcemaps in Build (web) to stop JS-heap OOM flake (monorepo[#1074](https://github.com/intent-hq/cloudlands-fe/issues/1074)) ([#541](https://github.com/intent-hq/cloudlands-fe/issues/541)) ([0550d3d](https://github.com/intent-hq/cloudlands-fe/commit/0550d3d6f07dff474814f03a2c778d27ad4a410b))
* **terminal:** remove unreachable container-level paste sanitizer ([#540](https://github.com/intent-hq/cloudlands-fe/issues/540)) ([e2515aa](https://github.com/intent-hq/cloudlands-fe/commit/e2515aa374c29253904ae8807501b873c2bfbd83))

## [2.10.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.9.0...v2.10.0) (2026-07-29)


### 🚀 Features

* adopt daemon turnId for chat retry-record correlation (monorepo[#1057](https://github.com/intent-hq/cloudlands-fe/issues/1057)) ([#531](https://github.com/intent-hq/cloudlands-fe/issues/531)) ([1ee63b0](https://github.com/intent-hq/cloudlands-fe/commit/1ee63b03b6304459534d4da71a8587c37bc011cf))
* **i18n:** add German (de), French (fr), and Spanish (es) locales ([#533](https://github.com/intent-hq/cloudlands-fe/issues/533)) ([c6ad1ea](https://github.com/intent-hq/cloudlands-fe/commit/c6ad1ea105c9d0a9d40674bb1aab902090ca7324))
* **i18n:** add Japanese (ja) and Korean (ko) locales ([#526](https://github.com/intent-hq/cloudlands-fe/issues/526)) ([a8e28e2](https://github.com/intent-hq/cloudlands-fe/commit/a8e28e26b9f7ad4a3608580b302efa6298be5ffe))


### 🐛 Bug Fixes

* **i18n:** localize daemon-provided terminal names ([#530](https://github.com/intent-hq/cloudlands-fe/issues/530)) ([eb9c215](https://github.com/intent-hq/cloudlands-fe/commit/eb9c215f975adafd72a7778ca9974be833cf499a))
* **i18n:** localize daemon-provided terminal names in metadata reads ([#535](https://github.com/intent-hq/cloudlands-fe/issues/535)) ([1af7ea9](https://github.com/intent-hq/cloudlands-fe/commit/1af7ea96c50f7b6848b27515d8c0767307666fff))
* **i18n:** translate settings_providerPath_runtime* keys in de/fr/es ([#536](https://github.com/intent-hq/cloudlands-fe/issues/536)) ([8d51d6f](https://github.com/intent-hq/cloudlands-fe/commit/8d51d6f523ea4240e6f0862d6a97763c8fc00ffb))
* localize runtime-generated chat strings (stream status + tool summaries) ([#525](https://github.com/intent-hq/cloudlands-fe/issues/525)) ([b36c116](https://github.com/intent-hq/cloudlands-fe/commit/b36c116f90e71213dcf370623b6e63815742fabe))
* prevent text-expansion overflow in sidebar tabs and action menus ([#539](https://github.com/intent-hq/cloudlands-fe/issues/539)) ([fc65cb4](https://github.com/intent-hq/cloudlands-fe/commit/fc65cb4444838f8d88c7a60e30841af6c170ed4f))
* settings provider path popup shows full daemon-resolved paths, override state, and both unsloth binaries ([#528](https://github.com/intent-hq/cloudlands-fe/issues/528)) ([6bc0d4f](https://github.com/intent-hq/cloudlands-fe/commit/6bc0d4fda8fffb9a1905e980a343188e8831d195))
* unsloth popup override targets the unsloth CLI ([#534](https://github.com/intent-hq/cloudlands-fe/issues/534)) ([e89c0b0](https://github.com/intent-hq/cloudlands-fe/commit/e89c0b0d581bebb53ec9b040434acb2023ff18f6))


### ⚡ Performance

* **diff:** send the batched file set as paths[] on git.diffs ([#538](https://github.com/intent-hq/cloudlands-fe/issues/538)) ([ef5147a](https://github.com/intent-hq/cloudlands-fe/commit/ef5147a9495d5b095b604990da70e42a65df7532))

## [2.9.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.8.0...v2.9.0) (2026-07-28)


### 🚀 Features

* providerCatalog Redux slice seeded from providers.catalog at connect time ([#517](https://github.com/intent-hq/cloudlands-fe/issues/517)) ([a1467a3](https://github.com/intent-hq/cloudlands-fe/commit/a1467a31e53423b83707dd0cedc0d8a8978fe7fa))
* switch Send-now to atomic agent.sendQueuedMessageNow; remove force() seam ([#520](https://github.com/intent-hq/cloudlands-fe/issues/520)) ([d8fbdaf](https://github.com/intent-hq/cloudlands-fe/commit/d8fbdaf33f963d00c7431b818c8ce98223c63cf2))


### 🐛 Bug Fixes

* migrate electron-builder win config to 26.x signtoolOptions schema (intent-hq/monorepo[#1047](https://github.com/intent-hq/monorepo/issues/1047)) ([bb7d8f3](https://github.com/intent-hq/cloudlands-fe/commit/bb7d8f3b0fbdefaaf4a40d2f2fcdd20b1e09a7e8))
* run generate:i18n before prebuild type-check so release builds pass (intent-hq/monorepo[#1046](https://github.com/intent-hq/monorepo/issues/1046)) ([1342eb1](https://github.com/intent-hq/cloudlands-fe/commit/1342eb19c226986bd4d7b4d819503b8a11ca7df1))

## [2.8.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.7.0...v2.8.0) (2026-07-28)


### 🚀 Features

* distinct session-corrupted error surface with recreate-aware retry copy ([#477](https://github.com/intent-hq/cloudlands-fe/issues/477)) ([7e91796](https://github.com/intent-hq/cloudlands-fe/commit/7e91796d7fc032594b257d2a54d187259729f320))
* **i18n:** add Simplified Chinese (zh-CN) locale ([#511](https://github.com/intent-hq/cloudlands-fe/issues/511)) ([c74e9e4](https://github.com/intent-hq/cloudlands-fe/commit/c74e9e42c53bb15b074246bda1fb0140a8a8661e))
* **i18n:** add Traditional Chinese (zh-TW) locale ([#514](https://github.com/intent-hq/cloudlands-fe/issues/514)) ([ce97f40](https://github.com/intent-hq/cloudlands-fe/commit/ce97f40b6dc686a4d0201075fcd347a13cc88156))
* **i18n:** extract all user-facing strings to Paraglide message catalog ([fd956be](https://github.com/intent-hq/cloudlands-fe/commit/fd956be7602559d632876d894e61d9cb29162c77))
* **i18n:** pseudo-locale and completeness CI check ([#509](https://github.com/intent-hq/cloudlands-fe/issues/509)) ([a20911a](https://github.com/intent-hq/cloudlands-fe/commit/a20911aca9e2c4a65a90d426a512bcea93f09f65))
* prefer OS native folder picker when daemon is local ([#479](https://github.com/intent-hq/cloudlands-fe/issues/479)) ([308766f](https://github.com/intent-hq/cloudlands-fe/commit/308766f5fd9cc2d8a13ba81016d3ca4ec13a5fc6))
* render agent-authored workspace status screenshot in the sidebar ([#501](https://github.com/intent-hq/cloudlands-fe/issues/501)) ([d150073](https://github.com/intent-hq/cloudlands-fe/commit/d1500733ffd7994f0189a69b0f8e345b04d6eb7d))
* restore legacy workspace import in settings ([#476](https://github.com/intent-hq/cloudlands-fe/issues/476)) ([7f45caa](https://github.com/intent-hq/cloudlands-fe/commit/7f45caaf48323786d8856e7f849ca2b61008d43b))


### 🐛 Bug Fixes

* always show all providers in model picker ([#951](https://github.com/intent-hq/cloudlands-fe/issues/951)) ([#474](https://github.com/intent-hq/cloudlands-fe/issues/474)) ([a26a53d](https://github.com/intent-hq/cloudlands-fe/commit/a26a53d19e7bb5b6530a1b5178c4569119ab4f28))
* carry image attachments through Try Again retry ([#965](https://github.com/intent-hq/cloudlands-fe/issues/965)) ([#486](https://github.com/intent-hq/cloudlands-fe/issues/486)) ([ce88aa5](https://github.com/intent-hq/cloudlands-fe/commit/ce88aa5821d610dccd54b36869ea69d40f3cf875))
* **chat:** clear stale chat error on queued retry and on queued-turn drain (monorepo[#1044](https://github.com/intent-hq/cloudlands-fe/issues/1044)) ([#515](https://github.com/intent-hq/cloudlands-fe/issues/515)) ([016c22a](https://github.com/intent-hq/cloudlands-fe/commit/016c22ad0b18f7e8d02c0fa2aa4398e1b75f37b2))
* clear lastAttemptedMessage on idle-reconcile finalize ([#973](https://github.com/intent-hq/cloudlands-fe/issues/973)) ([#488](https://github.com/intent-hq/cloudlands-fe/issues/488)) ([a5cb73a](https://github.com/intent-hq/cloudlands-fe/commit/a5cb73a5745888f5f2867a3d0e552f7a06c1f288))
* close 3 gaps in the turn-scoped retry-record design ([#510](https://github.com/intent-hq/cloudlands-fe/issues/510)) ([e4bfb02](https://github.com/intent-hq/cloudlands-fe/commit/e4bfb02fb487eebaf0e736d02ed2689a83299c51))
* coalesce legacy-event refetch storms in delta subscriptions ([#503](https://github.com/intent-hq/cloudlands-fe/issues/503)) ([fe63352](https://github.com/intent-hq/cloudlands-fe/commit/fe63352ec30af51dcc1904c86ec5460c96c18d41))
* derive stats provider short names from shared provider config ([#496](https://github.com/intent-hq/cloudlands-fe/issues/496)) ([e484719](https://github.com/intent-hq/cloudlands-fe/commit/e4847197e3779ddaa72780e6e63ff6608a83c7d6))
* drop parked retry records on a multi-entry clear-queue snapshot ([#513](https://github.com/intent-hq/cloudlands-fe/issues/513)) ([3807e1f](https://github.com/intent-hq/cloudlands-fe/commit/3807e1f80370b00e874fb53604eae2d113e4e009))
* keep retry records in sync on queued-message edit and lifecycle auto-queue ([#506](https://github.com/intent-hq/cloudlands-fe/issues/506)) ([3b6431a](https://github.com/intent-hq/cloudlands-fe/commit/3b6431abaeeca51e6fb4883aa2dbd5dfcecb5797))
* never render empty tool-call expansion; route ws.app.* in workspace_api parser ([#485](https://github.com/intent-hq/cloudlands-fe/issues/485)) ([86a5e25](https://github.com/intent-hq/cloudlands-fe/commit/86a5e25f48e2784b63b6fe5c5f10aa262ce55b9d))
* portal the Stop Server confirm dialog to body so it escapes the title bar ([#482](https://github.com/intent-hq/cloudlands-fe/issues/482)) ([ab7cefb](https://github.com/intent-hq/cloudlands-fe/commit/ab7cefb34dd7990665047260880fb4f86c082665))
* preserve retry payload across disposition-neutral stream:end ([#984](https://github.com/intent-hq/cloudlands-fe/issues/984)) ([#494](https://github.com/intent-hq/cloudlands-fe/issues/494)) ([4a608ae](https://github.com/intent-hq/cloudlands-fe/commit/4a608ae4680cd70d059ec8d954636736b4ea8022))
* re-home menu bar IPC listeners as a Redux middleware ([#498](https://github.com/intent-hq/cloudlands-fe/issues/498)) ([2776585](https://github.com/intent-hq/cloudlands-fe/commit/2776585aac8777652328b15a526757737ea2c8b4))
* re-home orphaned renderer IPC listeners (browser, git events, agent auth) as Redux middlewares ([#507](https://github.com/intent-hq/cloudlands-fe/issues/507)) ([a2839ba](https://github.com/intent-hq/cloudlands-fe/commit/a2839ba49249e386f7ee18f7764788c9e95c4f9d))
* record lastAttemptedMessage on the queue-on-send path ([#487](https://github.com/intent-hq/cloudlands-fe/issues/487)) ([fc1d533](https://github.com/intent-hq/cloudlands-fe/commit/fc1d533e31251f82929aa540d59d7d3f62757059))
* remove double border on custom toasts ([#490](https://github.com/intent-hq/cloudlands-fe/issues/490)) ([1655fd6](https://github.com/intent-hq/cloudlands-fe/commit/1655fd645fe31b57ab646a36f0d5cc42a3e96484))
* remove spurious leading space in user message bubble ([eb696ed](https://github.com/intent-hq/cloudlands-fe/commit/eb696ed0756bf76dc9eda89694f47994814140ae))
* resend correct message on Try Again after failed turn ([#941](https://github.com/intent-hq/cloudlands-fe/issues/941)) ([#481](https://github.com/intent-hq/cloudlands-fe/issues/481)) ([8e821b0](https://github.com/intent-hq/cloudlands-fe/commit/8e821b067a0d7718dfb1a30ba188c145a843a67a))
* resolve explicit specialist model over modelTier in main process (monorepo[#944](https://github.com/intent-hq/cloudlands-fe/issues/944)) ([#480](https://github.com/intent-hq/cloudlands-fe/issues/480)) ([0e80bf1](https://github.com/intent-hq/cloudlands-fe/commit/0e80bf1403d8c73537d6b5630c9bf51fd14794e2))
* restore missing agent response after transcript hydration race ([#505](https://github.com/intent-hq/cloudlands-fe/issues/505)) ([00b3ab6](https://github.com/intent-hq/cloudlands-fe/commit/00b3ab6c28bd6252160f2f2993e7b27b25651604))
* settings reset omits cowIsolation and repo search filter is unreachable ([#491](https://github.com/intent-hq/cloudlands-fe/issues/491)) ([b019023](https://github.com/intent-hq/cloudlands-fe/commit/b019023de42a4be37867a40beeedaf4645b401b2))
* show Q&A wizard while agent waits on delegated agents ([#484](https://github.com/intent-hq/cloudlands-fe/issues/484)) ([9272087](https://github.com/intent-hq/cloudlands-fe/commit/92720872f55383bbf6463375098c374561ac211b))
* suppress idle notifications when the agent awaits sub-agents ([#489](https://github.com/intent-hq/cloudlands-fe/issues/489)) ([a8de45b](https://github.com/intent-hq/cloudlands-fe/commit/a8de45bc18bb0ca0e53fa6d413e693cdf93ea022))
* turn-scoped retry records so a failed drained turn retries its own message ([#499](https://github.com/intent-hq/cloudlands-fe/issues/499)) ([2cdee99](https://github.com/intent-hq/cloudlands-fe/commit/2cdee99f6c964e89ca827c64d7acf43f3b9cb6a8))
* wire retry-with-model consumer and stop clobbering modelUnavailable ([#964](https://github.com/intent-hq/cloudlands-fe/issues/964)) ([#483](https://github.com/intent-hq/cloudlands-fe/issues/483)) ([aed4a8c](https://github.com/intent-hq/cloudlands-fe/commit/aed4a8c46e48b759dbba17c3f3e2b1f711e296a3))

## [2.7.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.6.0...v2.7.0) (2026-07-27)


### 🚀 Features

* add RepoConfig parity types with cowCloneExclude (intentd[#614](https://github.com/intent-hq/cloudlands-fe/issues/614)) ([#463](https://github.com/intent-hq/cloudlands-fe/issues/463)) ([7792469](https://github.com/intent-hq/cloudlands-fe/commit/7792469e0f1812573cabefe2232112e9b7b8167e))
* add unsloth provider surface ([#455](https://github.com/intent-hq/cloudlands-fe/issues/455)) ([fae8235](https://github.com/intent-hq/cloudlands-fe/commit/fae8235726672e88db93a54994fa30529d3d97bd))
* allow mid-conversation model/provider switching with confirmation and transcript notice ([#462](https://github.com/intent-hq/cloudlands-fe/issues/462)) ([8bd64c0](https://github.com/intent-hq/cloudlands-fe/commit/8bd64c06c5b4aa1c5d50e0c34a1063f7fed7484e))
* consume BE-owned workspace displayStatus ([#458](https://github.com/intent-hq/cloudlands-fe/issues/458)) ([ecc3a21](https://github.com/intent-hq/cloudlands-fe/commit/ecc3a210d965fe01afef9cc4d9a59483308a51d3))
* dedicated settings rows for CoW isolation and git credentials ([#466](https://github.com/intent-hq/cloudlands-fe/issues/466)) ([2e545f0](https://github.com/intent-hq/cloudlands-fe/commit/2e545f03329df870cf4caa3811983ccc94b00a34))
* settings toggle for git credentials in terminals and agents ([#454](https://github.com/intent-hq/cloudlands-fe/issues/454)) ([720b15b](https://github.com/intent-hq/cloudlands-fe/commit/720b15b73226e7ae03895cc24ba493c36d1ec7e8))
* show checkout-mode pill in the workspace overview panel ([#456](https://github.com/intent-hq/cloudlands-fe/issues/456)) ([b3ba9f4](https://github.com/intent-hq/cloudlands-fe/commit/b3ba9f41636bbd0840bd137b521b8093635741f7))
* show checkout-mode pill next to the org/repo subtitle ([#452](https://github.com/intent-hq/cloudlands-fe/issues/452)) ([3d715f6](https://github.com/intent-hq/cloudlands-fe/commit/3d715f6e286e838aaff4303014dbbc651ff89ccb))
* show managed unsloth server status in the intentd status indicator with a confirmed stop action ([#472](https://github.com/intent-hq/cloudlands-fe/issues/472)) ([23706d7](https://github.com/intent-hq/cloudlands-fe/commit/23706d70a857beced795e9bca31fc887d59a7e53))


### 🐛 Bug Fixes

* align checkout-mode pill to repo text baseline ([#469](https://github.com/intent-hq/cloudlands-fe/issues/469)) ([6c3bdf3](https://github.com/intent-hq/cloudlands-fe/commit/6c3bdf30b44788a9145507addc454057a71e13c3))
* clear chat error and start loading state on edit-and-regenerate ([#470](https://github.com/intent-hq/cloudlands-fe/issues/470)) ([7e12a59](https://github.com/intent-hq/cloudlands-fe/commit/7e12a5958f7fbc298bc9c4e44328a1d74dc3c15c))
* don't report all-done with staged or unpushed work after PR merge (monorepo[#912](https://github.com/intent-hq/cloudlands-fe/issues/912)) ([#461](https://github.com/intent-hq/cloudlands-fe/issues/461)) ([116c0b9](https://github.com/intent-hq/cloudlands-fe/commit/116c0b98713bdebf8578a35c09ab26c00f18bed5))
* **providers:** require unsloth CLI alongside opencode for unsloth availability ([#465](https://github.com/intent-hq/cloudlands-fe/issues/465)) ([04311b7](https://github.com/intent-hq/cloudlands-fe/commit/04311b7df25b77e579dfa9fb9972cb7079dc646a))
* return explicit specialist model before tier resolution in selectEffectiveModel ([#471](https://github.com/intent-hq/cloudlands-fe/issues/471)) ([6187f5d](https://github.com/intent-hq/cloudlands-fe/commit/6187f5dfa1eeb4a5a2bc33474e4a86bc58974150))
* stream raw script output chunks to xterm instead of line-splitting ([#467](https://github.com/intent-hq/cloudlands-fe/issues/467)) ([4f2254c](https://github.com/intent-hq/cloudlands-fe/commit/4f2254c078bed727ea5bb3cc4fe23ff4fb0d6447))
* treat open tasks as new work after PR merge in workflow stage ([#457](https://github.com/intent-hq/cloudlands-fe/issues/457)) ([4d36e92](https://github.com/intent-hq/cloudlands-fe/commit/4d36e92e0eaf233709736cad9b044e3e0b90a806))

## [2.6.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.5.0...v2.6.0) (2026-07-27)


### 🚀 Features

* add git/node requirements gate before provider setup in onboarding ([#440](https://github.com/intent-hq/cloudlands-fe/issues/440)) ([4fe4a7d](https://github.com/intent-hq/cloudlands-fe/commit/4fe4a7dfa4203b88a4033f0a78081602f2d9fcca))
* add Providers card to usage stats overlay ([#445](https://github.com/intent-hq/cloudlands-fe/issues/445)) ([8ab2e59](https://github.com/intent-hq/cloudlands-fe/commit/8ab2e598065d3dd12998cd80191fdbf7bfaeec7e))
* reveal agent sandbox in Finder from the agent card; fix broken Reveal in Finder detection ([#444](https://github.com/intent-hq/cloudlands-fe/issues/444)) ([1f05784](https://github.com/intent-hq/cloudlands-fe/commit/1f05784b4fae8450d9396086688cff3e2b4abf2b))
* show dimmed org/repo suffix in workspace repo picker and match branch brightness ([48d9683](https://github.com/intent-hq/cloudlands-fe/commit/48d9683a28e6c6edcb7d79cd3fdcea7774fa4d8d))
* tier onboarding provider cards by readiness ([#448](https://github.com/intent-hq/cloudlands-fe/issues/448)) ([b3e1475](https://github.com/intent-hq/cloudlands-fe/commit/b3e14750c9a6d03ca41856e36ccf56c2e67d4560))


### 🐛 Bug Fixes

* clear detected org/repo synchronously and drop stale remote-URL probe responses ([be2703a](https://github.com/intent-hq/cloudlands-fe/commit/be2703a9bee7aff6d696360bc4c6997c74977c41))
* gate "Other…" / "Choose app" open affordances on daemon locality (intent-hq/monorepo[#883](https://github.com/intent-hq/cloudlands-fe/issues/883)) ([2054762](https://github.com/intent-hq/cloudlands-fe/commit/20547623ebfd453dc55b86ee0d9a1e4abd878c60))
* give stats export hint a chip-style pill background for readability ([#436](https://github.com/intent-hq/cloudlands-fe/issues/436)) ([e47244f](https://github.com/intent-hq/cloudlands-fe/commit/e47244f6319aa4ce33a8a5c5c0dd30a18e6c73c8))
* keep detected org/repo suffix on branch-only onboarding selection changes ([#450](https://github.com/intent-hq/cloudlands-fe/issues/450)) ([f7c3bfc](https://github.com/intent-hq/cloudlands-fe/commit/f7c3bfce6dcb6a9b3c5da12b42429966543be721))
* pair tool results by toolCallId and show tool-call error output ([#442](https://github.com/intent-hq/cloudlands-fe/issues/442)) ([dbb7a7b](https://github.com/intent-hq/cloudlands-fe/commit/dbb7a7bc418977d233eeec900e3ee00366578ca0))
* remove green attention border from QuestionWizard well ([#438](https://github.com/intent-hq/cloudlands-fe/issues/438)) ([ba019a9](https://github.com/intent-hq/cloudlands-fe/commit/ba019a9a2923f26fd4dbfb7cd983a13ef5decbd0))
* render plain "Copy path" button when no open-capable actions remain (intent-hq/monorepo[#890](https://github.com/intent-hq/cloudlands-fe/issues/890)) ([296495b](https://github.com/intent-hq/cloudlands-fe/commit/296495b745a3bd8ccd66410920b6beb29120278a))
* show org/repo in sidebar Work on hover card ([#441](https://github.com/intent-hq/cloudlands-fe/issues/441)) ([0dc0e15](https://github.com/intent-hq/cloudlands-fe/commit/0dc0e15d338c02abacadd2146616546c3c0d2c92))

## [2.5.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.4.0...v2.5.0) (2026-07-27)


### 🚀 Features

* agent Q&A — question cards, sequential answer wizard, flattened Q:/A: replies (intent-hq/monorepo[#732](https://github.com/intent-hq/cloudlands-fe/issues/732)) ([832e44d](https://github.com/intent-hq/cloudlands-fe/commit/832e44dc9ebae1efb29f6771336293e28b57a8f3))
* animate delegation-list reordering with FLIP ([#430](https://github.com/intent-hq/cloudlands-fe/issues/430)) ([6adcbbd](https://github.com/intent-hq/cloudlands-fe/commit/6adcbbdd52d9abc100624a488d0f867ccc0aeb18))
* completion-aware ordering and monochrome avatars in delegation list ([#427](https://github.com/intent-hq/cloudlands-fe/issues/427)) ([b2c7c9e](https://github.com/intent-hq/cloudlands-fe/commit/b2c7c9e8d66625619b8e36d6843e76e3bc6d4b2d))
* consume structured base-ref-unresolvable error code in ProposalCard ([#394](https://github.com/intent-hq/cloudlands-fe/issues/394)) ([ab1d6fa](https://github.com/intent-hq/cloudlands-fe/commit/ab1d6fa61b4f557d5167d1630189c856dee1ba45))
* detect repo-config setup script for GitHub repos in new-workspace modal ([#417](https://github.com/intent-hq/cloudlands-fe/issues/417)) ([4614876](https://github.com/intent-hq/cloudlands-fe/commit/4614876467dfe54691cb9820b0a8f41c0842d67b))
* distinguish sidecar start-failure messaging and show last-run logs in the daemon dialog ([#402](https://github.com/intent-hq/cloudlands-fe/issues/402)) ([0e6de6c](https://github.com/intent-hq/cloudlands-fe/commit/0e6de6c2ce6fd9f468ddef1f566ad3f1202029c4))
* drop lines-changed row and add adjustable working hours (D15) ([#432](https://github.com/intent-hq/cloudlands-fe/issues/432)) ([3c717ca](https://github.com/intent-hq/cloudlands-fe/commit/3c717ca4f41dcc60c06bbdce430447ee63e06aa3))
* link out Auggie setup instructions and show explicit refresh feedback ([#406](https://github.com/intent-hq/cloudlands-fe/issues/406)) ([8ee92a2](https://github.com/intent-hq/cloudlands-fe/commit/8ee92a23869096132b3e88ee026c6cec16bee9d6))
* pre-flight clone destination validation on the onboarding GitHub tab ([#415](https://github.com/intent-hq/cloudlands-fe/issues/415)) ([84087f1](https://github.com/intent-hq/cloudlands-fe/commit/84087f14e8aed5840601a15de36a78f261bb3b38))
* re-probe repo config on branch change (intent-hq/monorepo[#835](https://github.com/intent-hq/cloudlands-fe/issues/835)) ([35d18a8](https://github.com/intent-hq/cloudlands-fe/commit/35d18a8e14422200c83811c42d6e826ff590890f))
* remove legacy workspace import from settings ([b770b65](https://github.com/intent-hq/cloudlands-fe/commit/b770b6504ea9aa76666adfc6c7228fd8da7af9d5))
* render agent-initiated (harness-wake) streams as implicit turns ([7e80fe3](https://github.com/intent-hq/cloudlands-fe/commit/7e80fe3c8d11d9217e4149d614f13ada4cc1d4f8))
* show owner-qualified repo names in RepoSelector recent list ([#431](https://github.com/intent-hq/cloudlands-fe/issues/431)) ([d2c6c79](https://github.com/intent-hq/cloudlands-fe/commit/d2c6c79655872e6c994414ab725888c714785105))
* use indicator Toggle for Custom MCP Servers master toggle ([#405](https://github.com/intent-hq/cloudlands-fe/issues/405)) ([e3076e3](https://github.com/intent-hq/cloudlands-fe/commit/e3076e36660f8597ac4dcca59666165e65805736))
* wire per-workspace typed channels (notes/tasks/agents/comments) for live-state ([#400](https://github.com/intent-hq/cloudlands-fe/issues/400)) ([c7d4d3a](https://github.com/intent-hq/cloudlands-fe/commit/c7d4d3ad7e469c62ddaee69b1d8b30d0fc2d35d9))
* wire the typed workspace.subscribe channel for live workspace state (monorepo[#775](https://github.com/intent-hq/cloudlands-fe/issues/775)) ([7286733](https://github.com/intent-hq/cloudlands-fe/commit/7286733f68573bc4eb2ebcdf1b69ffe4da67542f))


### 🐛 Bug Fixes

* accept canonical skipIsolation key in workspace:updated changes delta ([#399](https://github.com/intent-hq/cloudlands-fe/issues/399)) ([641a48e](https://github.com/intent-hq/cloudlands-fe/commit/641a48efbe992aeffc9c60d594d533bf5467f94f))
* add ariaLabel to remaining settings indicator toggles ([#816](https://github.com/intent-hq/cloudlands-fe/issues/816)) ([#412](https://github.com/intent-hq/cloudlands-fe/issues/412)) ([dbd3ebb](https://github.com/intent-hq/cloudlands-fe/commit/dbd3ebbbea730aa54fd3fbc517fc0275ac3b0415))
* add ariaLabel to settings indicator toggles ([#812](https://github.com/intent-hq/cloudlands-fe/issues/812)) ([#409](https://github.com/intent-hq/cloudlands-fe/issues/409)) ([7ce9fa1](https://github.com/intent-hq/cloudlands-fe/commit/7ce9fa1bce057adb7f622db28538c685e873b60b))
* deliver Q&A trailingBlocks live on agent:stream:end; render questions wizard-only (intent-hq/monorepo[#732](https://github.com/intent-hq/cloudlands-fe/issues/732)) ([a93df49](https://github.com/intent-hq/cloudlands-fe/commit/a93df49bf535dcd9891d5da5c7fc50bc00d08c72))
* enlarge working-hours stepper arrow click targets ([#434](https://github.com/intent-hq/cloudlands-fe/issues/434)) ([560ddb8](https://github.com/intent-hq/cloudlands-fe/commit/560ddb84c27bca26cae82b200debcf5d21f041f7))
* gate CoW toggle on system.capabilities; pass cowSupported/checkoutMode through schemas ([#408](https://github.com/intent-hq/cloudlands-fe/issues/408)) ([104a451](https://github.com/intent-hq/cloudlands-fe/commit/104a4517156729c39864a57e93c1abea154e88d8))
* harden path-type fields against non-string tool inputs ([#426](https://github.com/intent-hq/cloudlands-fe/issues/426)) ([1995d78](https://github.com/intent-hq/cloudlands-fe/commit/1995d78de66f06960766ed946bada3d3c3c5ce8b))
* harden unescapeContent against non-string tool input values ([#423](https://github.com/intent-hq/cloudlands-fe/issues/423)) ([250e139](https://github.com/intent-hq/cloudlands-fe/commit/250e13961d391a277f493d5213e852fc737808f8))
* hide port Save button when persisted value is retyped ([#814](https://github.com/intent-hq/cloudlands-fe/issues/814)) ([#411](https://github.com/intent-hq/cloudlands-fe/issues/411)) ([2d2ad8f](https://github.com/intent-hq/cloudlands-fe/commit/2d2ad8f8798c23ac9775c01b62e4f406f47d06cd))
* hide step counter, progress segments, and Back for single-question Q&A wizard ([#428](https://github.com/intent-hq/cloudlands-fe/issues/428)) ([bd302f5](https://github.com/intent-hq/cloudlands-fe/commit/bd302f5ea1f6793b5e5081d03dd90ff5443771cc))
* let typed ~ paths reach the daemon when the home listing is unavailable (monorepo[#824](https://github.com/intent-hq/cloudlands-fe/issues/824)) ([#416](https://github.com/intent-hq/cloudlands-fe/issues/416)) ([fa30a41](https://github.com/intent-hq/cloudlands-fe/commit/fa30a413817472d2a1ee576bd9af502dfef5ed52))
* map repo-not-found and access-denied daemon clone codes (intent-hq/monorepo[#842](https://github.com/intent-hq/cloudlands-fe/issues/842)) ([#425](https://github.com/intent-hq/cloudlands-fe/issues/425)) ([fccea8b](https://github.com/intent-hq/cloudlands-fe/commit/fccea8b221e33c524c50b513d2d23baafeaa09d7))
* map the daemon askpass-missing clone code, retire the auth-required prose exception (monorepo[#837](https://github.com/intent-hq/cloudlands-fe/issues/837)) ([525e821](https://github.com/intent-hq/cloudlands-fe/commit/525e8210c3e3d4e6c989379f42d8f086fa456e28))
* recognize agent:reportToParent wakes in event-wake summaries ([#413](https://github.com/intent-hq/cloudlands-fe/issues/413)) ([42f50b5](https://github.com/intent-hq/cloudlands-fe/commit/42f50b5a9bccf43e04f854bec72096cb9525c9be))
* render overlapping comment ranges as stacked per-comment spans ([#404](https://github.com/intent-hq/cloudlands-fe/issues/404)) ([35e024c](https://github.com/intent-hq/cloudlands-fe/commit/35e024cef58f47c3c4f16b0d0750bf36759b9693))
* restyle WebSocket API port input with shared Input component ([#407](https://github.com/intent-hq/cloudlands-fe/issues/407)) ([bb73828](https://github.com/intent-hq/cloudlands-fe/commit/bb73828c55786ae7d2878242f1a610a6d7b0b6a7))
* stop repo selection resetting the chosen clone destination ([#823](https://github.com/intent-hq/cloudlands-fe/issues/823)) ([#414](https://github.com/intent-hq/cloudlands-fe/issues/414)) ([fce0935](https://github.com/intent-hq/cloudlands-fe/commit/fce0935582e9b6b19a720cd3020a18d6e5072a68))
* stop spawn-time model picks from mutating the global default model ([#429](https://github.com/intent-hq/cloudlands-fe/issues/429)) ([32581ab](https://github.com/intent-hq/cloudlands-fe/commit/32581ab26eca29d8a90653c91a14e55050021047))
* surface daemon clone failure detail in onboarding instead of "Internal error" (monorepo[#826](https://github.com/intent-hq/cloudlands-fe/issues/826)) ([9148b9d](https://github.com/intent-hq/cloudlands-fe/commit/9148b9df3b58dbd9f0e57ac3ff0a32b158870b76))
* vertically center stats overlay content when it fits the viewport ([#410](https://github.com/intent-hq/cloudlands-fe/issues/410)) ([885067e](https://github.com/intent-hq/cloudlands-fe/commit/885067eba9d094e6fe04f3ba5c9fa16b95f0e4cb))

## [2.4.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.3.0...v2.4.0) (2026-07-25)


### 🚀 Features

* add settings control for legacy workspace import ([#327](https://github.com/intent-hq/cloudlands-fe/issues/327)) ([2ddaa0c](https://github.com/intent-hq/cloudlands-fe/commit/2ddaa0cc28949f9af44b9aae6ed7b429d393554f))
* agentic usage stats overlay with exportable bragging-rights cards ([#393](https://github.com/intent-hq/cloudlands-fe/issues/393)) ([8b85cda](https://github.com/intent-hq/cloudlands-fe/commit/8b85cda40f805e6bf6c73f96c0e3d50e226ffdcf))
* aggregated agent-failure toast with grouped Retry All ([#385](https://github.com/intent-hq/cloudlands-fe/issues/385)) ([898cc91](https://github.com/intent-hq/cloudlands-fe/commit/898cc910d70ff84fd1e2571d94c7e082960d6142))
* bundle iA Writer Mono and JetBrains Mono, drop Berkeley Mono ([#379](https://github.com/intent-hq/cloudlands-fe/issues/379)) ([cad67fb](https://github.com/intent-hq/cloudlands-fe/commit/cad67fbe3e8c9797671f6bc1bb9ebd93ad208462))
* CoW toggle visibility, skipIsolation, and mode-aware creation copy ([#382](https://github.com/intent-hq/cloudlands-fe/issues/382)) ([3486076](https://github.com/intent-hq/cloudlands-fe/commit/3486076d6fa600b6d902c7633dd64ec79220e3dd))
* hide hidden specialists from pickers ([#363](https://github.com/intent-hq/cloudlands-fe/issues/363)) ([f5a5ee1](https://github.com/intent-hq/cloudlands-fe/commit/f5a5ee12f7fda435f31d86615681648832a03b37))
* MIME-keyed card registry + prefer daemon-attached blocks ([#376](https://github.com/intent-hq/cloudlands-fe/issues/376)) ([552bf9b](https://github.com/intent-hq/cloudlands-fe/commit/552bf9b54eee94f4224ab039cab0bb1fe21e25a2))
* pass the optimistic comment id through comment.add ([#392](https://github.com/intent-hq/cloudlands-fe/issues/392)) ([9a9bf11](https://github.com/intent-hq/cloudlands-fe/commit/9a9bf11084503d96808f15debd7043decfe276a5))
* remember last used context source and order providers dynamically ([cb2bd4c](https://github.com/intent-hq/cloudlands-fe/commit/cb2bd4c3b9d83738a4ec9fb76d8ff73d67c97a70))
* rename chief thread on first user message ([#377](https://github.com/intent-hq/cloudlands-fe/issues/377)) ([682bb1c](https://github.com/intent-hq/cloudlands-fe/commit/682bb1c4eb1a2788c8a4a962927edb287adfb382))
* render Stopped indicator live on interrupted agent:stream:end ([#375](https://github.com/intent-hq/cloudlands-fe/issues/375)) ([62d82d0](https://github.com/intent-hq/cloudlands-fe/commit/62d82d060f9bf5fd322ccd02efe248e1d92bc9e4))
* warn and preselect default branch when proposed base branch is missing ([#761](https://github.com/intent-hq/cloudlands-fe/issues/761)) ([76ff994](https://github.com/intent-hq/cloudlands-fe/commit/76ff994cd57b740f76459434941d252cb9babd5c))


### 🐛 Bug Fixes

* apply archivedAt from workspace:updated delta in daemon events bridge ([#383](https://github.com/intent-hq/cloudlands-fe/issues/383)) ([6571085](https://github.com/intent-hq/cloudlands-fe/commit/65710852947a8ef6fc908b92a86d57aee5f10578))
* cap vitest workers and raise test timeouts to stop full-suite flakiness ([#356](https://github.com/intent-hq/cloudlands-fe/issues/356)) ([0b0a605](https://github.com/intent-hq/cloudlands-fe/commit/0b0a605d88b34d18bc1dff699521e50dcc32a89f))
* exempt replies from scanAnchorHealth orphan evaluation (monorepo[#749](https://github.com/intent-hq/cloudlands-fe/issues/749)) ([#380](https://github.com/intent-hq/cloudlands-fe/issues/380)) ([e259b84](https://github.com/intent-hq/cloudlands-fe/commit/e259b845caae09818fe300d559de06d19eb4b0e7))
* harden chief thread rename trigger for queued and degraded-hydration edge cases (intent-hq/monorepo[#745](https://github.com/intent-hq/cloudlands-fe/issues/745)) ([#378](https://github.com/intent-hq/cloudlands-fe/issues/378)) ([bddec09](https://github.com/intent-hq/cloudlands-fe/commit/bddec091bfedde12bf3eaa245057fe1de640565c))
* never render a stale cached workspace after deletion ([#390](https://github.com/intent-hq/cloudlands-fe/issues/390)) ([7f6bb84](https://github.com/intent-hq/cloudlands-fe/commit/7f6bb84a01bf61910b3fb9886110c22323c5f6dd))
* orphan check understands bare anchor ids and thread-root anchoring ([#387](https://github.com/intent-hq/cloudlands-fe/issues/387)) ([15e7a67](https://github.com/intent-hq/cloudlands-fe/commit/15e7a673515a60c03fca7ca2ad2a88e255aeca00))
* pass nameExplicitlySet:false on launch-path sites; forward it through the browser-mode bridge ([#675](https://github.com/intent-hq/cloudlands-fe/issues/675)) ([bbb4f90](https://github.com/intent-hq/cloudlands-fe/commit/bbb4f90341ce4583361472b65bc46212c3c34347))
* persist stable clientId for client.hello and flush new-workspace draft saves on unload ([#372](https://github.com/intent-hq/cloudlands-fe/issues/372)) ([da78fd4](https://github.com/intent-hq/cloudlands-fe/commit/da78fd4dc2c212773f85342f19ed7caa5e525a55))
* release WebGL context and GPU resources on AuroraBackground cleanup ([#389](https://github.com/intent-hq/cloudlands-fe/issues/389)) ([d09c34f](https://github.com/intent-hq/cloudlands-fe/commit/d09c34f1366fe5e569580c1dd672815801a8fbb9))
* repair provider-wrapped JSON in the collapsed-output proposal lift ([#347](https://github.com/intent-hq/cloudlands-fe/issues/347)) ([a539f51](https://github.com/intent-hq/cloudlands-fe/commit/a539f5162948af5e784a24c5e481b686f4fd95e1))
* restore legacy refetches until a subscription.push is observed (monorepo[#775](https://github.com/intent-hq/cloudlands-fe/issues/775)) ([232d0f7](https://github.com/intent-hq/cloudlands-fe/commit/232d0f7c28e049aac44eff15463d6b6d6f22d85b))
* route bulk-op proposal Apply through real archive/delete handlers ([#353](https://github.com/intent-hq/cloudlands-fe/issues/353)) ([825b6bf](https://github.com/intent-hq/cloudlands-fe/commit/825b6bf78855273a1d6d1b62c60057107f341281))
* shell-free argv for workspace preflightCloneCheck, drop escapeShellArg ([#360](https://github.com/intent-hq/cloudlands-fe/issues/360)) ([a4d1dce](https://github.com/intent-hq/cloudlands-fe/commit/a4d1dce4188fed8d3848d9785e2b6578e0a6754f))
* show a not-found page when opening a deleted workspace ([#386](https://github.com/intent-hq/cloudlands-fe/issues/386)) ([a9b37fb](https://github.com/intent-hq/cloudlands-fe/commit/a9b37fb4ad566e4e66a5b26871814dc53e513a33))
* stop falsely orphaning comments whose anchorText is markdown (monorepo[#710](https://github.com/intent-hq/cloudlands-fe/issues/710)) ([#371](https://github.com/intent-hq/cloudlands-fe/issues/371)) ([220e1f2](https://github.com/intent-hq/cloudlands-fe/commit/220e1f2cc20c10772ce79cad671ce8fcc4d91890))
* stop shell-interpolating paths in main-process exec calls (monorepo[#672](https://github.com/intent-hq/cloudlands-fe/issues/672)) ([782d09c](https://github.com/intent-hq/cloudlands-fe/commit/782d09c8f352c14ee61b50a6b16f4c880b5b14c3))
* stop synthesizing/cloning reply anchors in loadComments and replyToComment (monorepo[#754](https://github.com/intent-hq/cloudlands-fe/issues/754)) ([#381](https://github.com/intent-hq/cloudlands-fe/issues/381)) ([63891ca](https://github.com/intent-hq/cloudlands-fe/commit/63891cabf7100a710d872e50b3bdf09a7f49c9d4))
* use execFile argv for IDE-launch exec sites ([#354](https://github.com/intent-hq/cloudlands-fe/issues/354)) ([272c946](https://github.com/intent-hq/cloudlands-fe/commit/272c946a2144d69ae28245ff837ff001ba17beeb))

## [2.3.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.2.0...v2.3.0) (2026-07-24)


### 🚀 Features

* consolidated intentd delta in stable promotion notes ([#339](https://github.com/intent-hq/cloudlands-fe/issues/339)) ([a6e2434](https://github.com/intent-hq/cloudlands-fe/commit/a6e24349cedafc4024f707ea05c672929f99ce44))
* render intentd commit delta in release notes ([#336](https://github.com/intent-hq/cloudlands-fe/issues/336)) ([474bb27](https://github.com/intent-hq/cloudlands-fe/commit/474bb279a9640f67f7e53d4d6c6ccfe9e7d93ee9))
* send authorType user on comment thread replies ([#333](https://github.com/intent-hq/cloudlands-fe/issues/333)) ([204a029](https://github.com/intent-hq/cloudlands-fe/commit/204a029c609a3f69754edb9f0d6dbaeef62d1fad))
* thread workspaceId through remaining resolver call sites + consume echoed noteRev ([#342](https://github.com/intent-hq/cloudlands-fe/issues/342)) ([fd7bd1b](https://github.com/intent-hq/cloudlands-fe/commit/fd7bd1baa38d21c49abf8942bae983cc4b8ac6cc))
* wire previous intentd pin into the beta release workflow ([#338](https://github.com/intent-hq/cloudlands-fe/issues/338)) ([2ec589e](https://github.com/intent-hq/cloudlands-fe/commit/2ec589edc60b6010a680812ca0eeeca447044b63))


### 🐛 Bug Fixes

* advance note rev through the mutation queue on comment.add ([#334](https://github.com/intent-hq/cloudlands-fe/issues/334)) ([06e9a4e](https://github.com/intent-hq/cloudlands-fe/commit/06e9a4e441aa30dcfce85d60bc7c9ec5ad97f5f4))
* editor sync trio — flush-window revert, typing-window drop, suppression-window keystroke loss ([#340](https://github.com/intent-hq/cloudlands-fe/issues/340)) ([cab7608](https://github.com/intent-hq/cloudlands-fe/commit/cab7608891466f84343be40472824eccf1fe2911))
* nameExplicitlySet follow-ups — generated-name paths, rename seam, wire tests ([#525](https://github.com/intent-hq/cloudlands-fe/issues/525)) ([fcfe395](https://github.com/intent-hq/cloudlands-fe/commit/fcfe395e75781602ba5995c3df9833304f349248))
* pass explicit workspaceId in comment/note mutations for shared note ids ([#331](https://github.com/intent-hq/cloudlands-fe/issues/331)) ([75cb149](https://github.com/intent-hq/cloudlands-fe/commit/75cb149fd545cab0b00c5ffe575cd6238c09ace7))
* render ProposalCard for provider-collapsed proposal outputs at runtime ([#337](https://github.com/intent-hq/cloudlands-fe/issues/337)) ([6eb2018](https://github.com/intent-hq/cloudlands-fe/commit/6eb20185235aefffef1f915d64b9cf11b2e19c72))
* reply composer avatar reflects the user instead of hardcoded A ([#345](https://github.com/intent-hq/cloudlands-fe/issues/345)) ([39ffcbd](https://github.com/intent-hq/cloudlands-fe/commit/39ffcbd21c5a887788e87922cfc98f557ea98400))
* require workspaceId for cwd in EXECUTE_COMMAND_STREAMING (intent-hq/monorepo[#588](https://github.com/intent-hq/cloudlands-fe/issues/588)) ([568f7bd](https://github.com/intent-hq/cloudlands-fe/commit/568f7bd7a5de59e3bca420c40ae1253d9460c5ee))
* resubscribe live skills/specialists clients on reconnect and keep last-known-good on refetch failure ([#335](https://github.com/intent-hq/cloudlands-fe/issues/335)) ([1a4db81](https://github.com/intent-hq/cloudlands-fe/commit/1a4db81618be822a0e30dab11777418d027e8d95))
* seed PATH after sidecar startup ([#325](https://github.com/intent-hq/cloudlands-fe/issues/325)) ([8c880a5](https://github.com/intent-hq/cloudlands-fe/commit/8c880a58a516d9cea4b121cbbafca87462ce4be0))
* serialize ClientLogger data payload into log message ([#348](https://github.com/intent-hq/cloudlands-fe/issues/348)) ([4a0eb3e](https://github.com/intent-hq/cloudlands-fe/commit/4a0eb3e804d57b0d6c1ab67ece149dba2f42a847))
* single-quote installCli osascript shell command ([#351](https://github.com/intent-hq/cloudlands-fe/issues/351)) ([c5b0f32](https://github.com/intent-hq/cloudlands-fe/commit/c5b0f32490b372bfe5512677f9f191968da0b888))
* skip release-plz bump commits and add blank line before section headings ([#341](https://github.com/intent-hq/cloudlands-fe/issues/341)) ([a348336](https://github.com/intent-hq/cloudlands-fe/commit/a348336e2c36a8261ba17758793b9e44f03d7ef5))
* snapshot recentRepos before dispatching into Redux ([#346](https://github.com/intent-hq/cloudlands-fe/issues/346)) ([b62a51c](https://github.com/intent-hq/cloudlands-fe/commit/b62a51cff5e51d2984a3ec76ea63ab43b7a7bdfa))

## [2.2.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.1.0...v2.2.0) (2026-07-24)


### 🚀 Features

* live-refresh specialists on specialists:changed ([#329](https://github.com/intent-hq/cloudlands-fe/issues/329)) ([2d5e910](https://github.com/intent-hq/cloudlands-fe/commit/2d5e9104d0692342fc3ff5bcbbca621039f500cb))


### 🐛 Bug Fixes

* ignore workspace default model when its provider is disabled ([#322](https://github.com/intent-hq/cloudlands-fe/issues/322)) ([ce3f66f](https://github.com/intent-hq/cloudlands-fe/commit/ce3f66fcc78d8591314acde20253378debb7711f))
* include mention-chip text in comment.add search context ([#324](https://github.com/intent-hq/cloudlands-fe/issues/324)) ([fcaa212](https://github.com/intent-hq/cloudlands-fe/commit/fcaa2127760a2f4c11f0357c48c593a93f0a57a5))
* pass workspaceId through system:execute-command to host.exec ([#537](https://github.com/intent-hq/cloudlands-fe/issues/537)) ([#312](https://github.com/intent-hq/cloudlands-fe/issues/312)) ([bf14dbc](https://github.com/intent-hq/cloudlands-fe/commit/bf14dbced24a98dcdc86d8fc98de7a2404fa0c6b))
* preserve imageBlocks on queue-on-send messages ([0272cb6](https://github.com/intent-hq/cloudlands-fe/commit/0272cb6b5ffd9cce58d9e8d4e4341fdc75eb0b3d))
* reconcile provider with resolved model at workspace creation ([#316](https://github.com/intent-hq/cloudlands-fe/issues/316)) ([e9cccbf](https://github.com/intent-hq/cloudlands-fe/commit/e9cccbfa49785a36fa4053e2bdf3bba0a202f842))
* retire cwd-only cd wrapper; enforce cwd requires workspaceId at schema level (monorepo[#578](https://github.com/intent-hq/cloudlands-fe/issues/578)) ([#321](https://github.com/intent-hq/cloudlands-fe/issues/321)) ([cfcb272](https://github.com/intent-hq/cloudlands-fe/commit/cfcb272521e2cebdb1a189cb23a7b549a2279693))
* show all enabled providers in ModelPicker for unlocked agents ([#309](https://github.com/intent-hq/cloudlands-fe/issues/309)) ([d88c948](https://github.com/intent-hq/cloudlands-fe/commit/d88c9482125bbec82a1dcc37c92c32a11d886806))
* single-quote amend messages so backticks pass literally (monorepo[#579](https://github.com/intent-hq/cloudlands-fe/issues/579)) ([a3bcacc](https://github.com/intent-hq/cloudlands-fe/commit/a3bcacc14c98f134936b20bd09de909cd5e97fff))

## [2.1.0](https://github.com/intent-hq/cloudlands-fe/compare/v2.0.13...v2.1.0) (2026-07-23)


### 🚀 Features

* bridge system:execute-command to daemon host.exec on web ([#296](https://github.com/intent-hq/cloudlands-fe/issues/296)) ([395969d](https://github.com/intent-hq/cloudlands-fe/commit/395969da4cccb4cc1b0c90e2befa6f81ea3f4144))
* **ci:** rework release-beta to be tag-triggered ([#300](https://github.com/intent-hq/cloudlands-fe/issues/300)) ([d7544aa](https://github.com/intent-hq/cloudlands-fe/commit/d7544aaf6f46da1eff21dd5e8f078164530cd8b1))
* in-app file-conflict dialog for web builds ([#289](https://github.com/intent-hq/cloudlands-fe/issues/289)) ([8245302](https://github.com/intent-hq/cloudlands-fe/commit/82453025e33d6f388968bc4c5e5c5fc424e5b21c))
* persist New Workspace modal draft (text + images) via daemon drafts API ([#303](https://github.com/intent-hq/cloudlands-fe/issues/303)) ([c8fca23](https://github.com/intent-hq/cloudlands-fe/commit/c8fca23abcc0ccb7dff9327c2dd23286a1133ba6))
* render and apply daemon-delivered standalone proposal blocks ([#290](https://github.com/intent-hq/cloudlands-fe/issues/290)) ([fa16266](https://github.com/intent-hq/cloudlands-fe/commit/fa162660c3dffb929667754c6001c81d569d1e8f))
* render clickable inline image thumbnails in QueuedMessageList ([#272](https://github.com/intent-hq/cloudlands-fe/issues/272)) ([9468c53](https://github.com/intent-hq/cloudlands-fe/commit/9468c53552888aba3e73388dbc8c111895cd05e6))
* server-side search + infinite scroll in context picker ([#305](https://github.com/intent-hq/cloudlands-fe/issues/305)) ([249a713](https://github.com/intent-hq/cloudlands-fe/commit/249a71345fdf4662b40696a50fbc0b2531cbe881))
* thread query + nextToken through integrations plumbing ([#301](https://github.com/intent-hq/cloudlands-fe/issues/301)) ([f8f7e59](https://github.com/intent-hq/cloudlands-fe/commit/f8f7e5954c2a571e59021c59b76aae4c18cbbdcb))
* web Notifications API substitute for native notifications ([#298](https://github.com/intent-hq/cloudlands-fe/issues/298)) ([6cbd776](https://github.com/intent-hq/cloudlands-fe/commit/6cbd776c08651d9c3817934615bafa698785fe2c))


### 🐛 Bug Fixes

* align onboarding needsLogin semantics with settings (unknown != needs login) ([#270](https://github.com/intent-hq/cloudlands-fe/issues/270)) ([d4f8568](https://github.com/intent-hq/cloudlands-fe/commit/d4f85688ec8355403bacd10c8a2c80dedfc38cbd))
* converge open note editor to server content after local edits are saved ([#280](https://github.com/intent-hq/cloudlands-fe/issues/280)) ([2163aef](https://github.com/intent-hq/cloudlands-fe/commit/2163aef0698769d8ab606242596e854767925b89))
* false 'intentd is stopped' overlay in dev:web (bridge live WS transport status into the browser mock) ([55051ee](https://github.com/intent-hq/cloudlands-fe/commit/55051ee51827e092090cc21b2606a2ee330c2eb1))
* guard panel-layout persistence against pre-restore clobber of initial agent tab ([#276](https://github.com/intent-hq/cloudlands-fe/issues/276)) ([eea65c4](https://github.com/intent-hq/cloudlands-fe/commit/eea65c4aecec7720abc75f7e2fc9d1c571e7ac1d))
* persist agent renames and allow self-rename of placeholder names ([#275](https://github.com/intent-hq/cloudlands-fe/issues/275)) ([66937bf](https://github.com/intent-hq/cloudlands-fe/commit/66937bf1a5505e51682f34e8a9973e13f7616386))
* pin CODEX_PATH/CODEX_CONFIG to empty in managed codex-acp spawns ([9c26736](https://github.com/intent-hq/cloudlands-fe/commit/9c267360788e94cd9bb9da8c4819d74f946b92ce))
* reliably focus the comment textarea when the comment dialog opens ([#278](https://github.com/intent-hq/cloudlands-fe/issues/278)) ([31d050b](https://github.com/intent-hq/cloudlands-fe/commit/31d050b314e236aa875c5aa4a41c7637ce5676e0))
* remove Auggie Ready status badge in provider settings ([#274](https://github.com/intent-hq/cloudlands-fe/issues/274)) ([aac3b5b](https://github.com/intent-hq/cloudlands-fe/commit/aac3b5bff14ad92f21146f74623998b7f94ce77e))
* resolve CodeQL code scanning alerts ([#282](https://github.com/intent-hq/cloudlands-fe/issues/282)) ([cbeb5b8](https://github.com/intent-hq/cloudlands-fe/commit/cbeb5b8e394ad3512d48a3754fe9ff8f794dbe9c))
* restructure managed codex-acp runtime for @agentclientprotocol/codex-acp ([#283](https://github.com/intent-hq/cloudlands-fe/issues/283)) ([5f17d34](https://github.com/intent-hq/cloudlands-fe/commit/5f17d345111e0ef4aa7ce34b4189051f081dd787))
* show waiting agents in home page workspace rows to match sidebar ([#279](https://github.com/intent-hq/cloudlands-fe/issues/279)) ([685173c](https://github.com/intent-hq/cloudlands-fe/commit/685173cb3c46df13ef0bf3156d041d91e7e60518))
* **sidecar:** bump intentd pin to 0.2.3 ([#307](https://github.com/intent-hq/cloudlands-fe/issues/307)) ([5ec2e4c](https://github.com/intent-hq/cloudlands-fe/commit/5ec2e4ca05168175bb1cd986fa537efc8d9f77d0))
* surface empty-with-warning providers in the ModelPicker instead of hiding them ([#273](https://github.com/intent-hq/cloudlands-fe/issues/273)) ([0429f93](https://github.com/intent-hq/cloudlands-fe/commit/0429f93d78366909015c86d187730a17005e95cb))
* update vulnerable dependencies to resolve 57 Dependabot alerts ([#288](https://github.com/intent-hq/cloudlands-fe/issues/288)) ([4a9a619](https://github.com/intent-hq/cloudlands-fe/commit/4a9a61953eda015ef0a245cd3c311f3ae57bf062))

## [2.0.13](https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.0.13) (2026-07-23)

Last release cut before auto-generated changelog entries were introduced; see the releases page for its notes.

---

## Historical Releases (0.x)

The entries below document releases prior to 2.0.0.

## 0.4.0

- Diffs in agent responses now render with the full diff viewer instead of plain code blocks.
- MCP tools that went missing after workspace recovery are now restored automatically, with new stopped/restart status indicators so you can see when a tool server needs attention.
- Agents start more reliably when opening a workspace, even when the backend is slow to respond.
- Spec panel auto-opens in a split pane when a coordinator starts writing to it.
- Improved error reporting for background process failures.
- Fixes: file tree rendering inconsistencies, changes tab not populating after workspace open, commit message auto-fill from idle agent summaries, external file edits not reloading in the editor, changes list flickering, merged PR status not updating in the sidebar, and agent messages occasionally targeting the wrong conversation.

## 0.3.12

- Notes now have a raw view toggle so you can see and edit the underlying Markdown source.
- Panel search bars have been consolidated into a single, consistent UI across chat, notes, and other panels.
- If your configured default provider isn't installed, Intent now auto-selects an available one instead of leaving you stuck.
- Upgraded to Electron 41 for security and performance improvements.
- Fixes: embedded browser no longer reloads the page during in-app navigation on single-page sites, duplicate or missing assistant messages when agents reconnect or activate, follow-up messages occasionally getting dropped right after an agent finished streaming, and a timeout edge case in the auto-commit message generator.

## 0.3.11

- New "Open in…" toggles in workspace settings let you hide editors you don't use from the Open In menu and combo button.
- Terminal sidebar now has a button for creating new terminals directly from the sidebar.
- Notes editor now supports inline checkbox shortcuts so you can create checkboxes without leaving the keyboard.
- Workspace recency timestamps are accurate again, so your most recently used spaces stay sorted correctly across the homepage, command palette, and spaces switcher.
- Workspace hover cards now stay in sync as agent statuses change in real time.
- Fixes: memory spike from session stats polling, occasional saga crash on startup, task status icons handle unknown states gracefully, and MCP agent headers no longer fail when names contain non-ASCII characters.

## 0.3.10

- Workspace UI now shows Auggie credit usage stats, with per-agent breakdowns on hover.
- Home view gets workspace status and hover cards so you can see what's happening across your spaces at a glance.
- Codex model picker now uses your installed codex CLI when available, so newer models like GPT-5.5 show up automatically.
- Links in notes are now underlined so they're easier to spot.
- Workspace creation messaging is clearer when running without a worktree.
- Security: tightened the HTTP MCP bridge so it no longer exposes itself broadly on the network.
- Fixes: idle agents no longer appear as "responding" in the overview, animation glitches and noisy queued-stream logs, home workspace column widths, `.app` files now detected by content instead of extension, and stale agent replies no longer overwrite newer user messages.

## 0.3.9

- Model picker now surfaces the actual provider error (e.g. invalid key, network failure) instead of a generic "Failed to load models" message.
- Fixes: duplicate assistant messages appearing in chat, double initial agent stream when opening a workspace.

## 0.3.8

- Diff viewer performance improvements.
- Copy the current browser panel URL with a keyboard shortcut.
- Model picker no longer shows stale or cached values from previous sessions, and unknown model names now fuzzy-match to the closest available model instead of being silently dropped.
- Fixes: ACP tool-call updates not matching correct agents, agent wake notifications occasionally creating duplicate messages, deleted workspaces reappearing when multiple were removed in quick succession.

## 0.3.7

- Changes panel loads noticeably faster on workspaces with many agents, and the file explorer no longer re-renders the entire tree every time a file is saved.
- Agent state is preserved correctly when switching between workspaces instead of momentarily showing the wrong agent.
- Fixes: duplicate message flashes during streaming, Emacs-style Ctrl key shortcuts in the editor firing on Windows/Linux where they shouldn't.

## 0.3.6

- Model picker no longer swaps your selected model when a provider is slow to load — auto-fallback now waits for the user's provider to actually settle instead of reacting to transient empty results.
- Cmd+F in chat now reliably scrolls to every match, including those inside virtualized turns that were previously skipped.
- Agent renames and deletes propagate to other windows within seconds instead of minutes.
- Fixes: Stop button clicks during agent creation are honored instead of being silently lost, delegation-group race that left coordinators stuck waiting on already-finished sub-agents, custom agent names preserved across subsequent renames, infinite render loop (`effect_update_depth_exceeded`) when opening some workspaces, hardened PR discovery and assorted changes panel bugs from the underlying git state refactor.

## 0.3.5

- Homepage workspace list now caps at 10 with a collapsible "Older" section to keep things tidy.
- Agent previews show the tool icon and label when the latest block is a tool call, so you can tell at a glance what an agent is doing.
- Image token usage is optimized to use less context when working with images.
- Enhanced deep link support for easy workspace creation.
- Fixes: ACP agents recovering from invalid tool-call history, workspace switching preserves layouts, shutdown UX and orphan-recovery race guards tightened, duplicate streaming assistant messages, agents no longer appear stuck as streaming in the overview tree, running delegated agents are visible when collapsed and sorted by recency, PR branch matching strips remote prefixes correctly, OS notifications and the bell fire again on agent idle, HttpMcpBridge restart race and orphan recovery for stuck agents, and duplicate image previews.

## 0.3.4

- Claude Opus 4.7 is now the default model for Auggie agents.
- Onboarding flow redesigned for a smoother first-run experience, with fixes for opencode-only setups.
- Agents are more resilient under memory pressure — they're no longer killed mid-response, even in background workspace tabs.
- Terminal titles are now sanitized to prevent credentials from leaking into the window title.
- Agent suggested prompts are back.
- Fixes: repeated identical messages no longer silently dropped, user messages preserved during concurrent saves, in-flight message queueing is more reliable, chat messages merge correctly with on-disk content when reopening a chat, delegated agent wake-up and subscription reliability, spec and note updates now reactively reflect task changes, dropdown crash from duplicate options, custom specialists stranded during a prior migration now recover correctly, and a streaming hang when the "done" notification arrives before stream close.

## 0.3.0

- Project-level custom specialists now load reliably, live-reload when you save changes, and show where each specialist comes from (project, user, or built-in).
- Workspace API tool calls now show rich previews in chat so you can see what workspace actions agents are performing.
- Major memory and resource improvements — idle agent processes and MCP servers are reclaimed under memory pressure, keeping things snappy on long sessions.
- Agent streaming overhaul — fixed a batch of issues that caused stuck "Thinking" states, lost messages, and infinite loops during multi-agent work.
- Fixes: agent-to-agent messages failing during interrupts, delegation events dropped on delivery failure, workspace disappearing after cleanup, panels not restoring on workspace re-open, model reverting when editing earlier messages, workspace list showing duplicate groups, notes not updating after task changes.

## 0.2.37

- Archive and delete workspaces directly from the sidebar context menu.
- Window layout is now restored after auto-updates — your open tabs and panels survive restarts.
- Model picker polish: improved layout, provider logos always visible, and the picker locks after the first message as expected.
- Idle agent processes are now cleaned up automatically, capping resource usage on long-running sessions.
- Fixes: markdown code blocks not rendering in narrow chat panels, stack overflow when sending messages with inline images, suggested reply edit button not working, memory leak from large unparseable stream messages, workspace creation modal applying the wrong initial repo, chat loading and agent wake-up reliability improvements.

## 0.2.36

- MCP tool calls now show brand logos and structured previews so you can see what tools are doing at a glance.
- New Spaces automatically inherit your globally disabled MCP servers — no need to re-disable them each time.
- Create PR, Merge, and Push buttons now appear reliably after commits and merges.
- Linear tool integration now works correctly.
- Fixes: workspace not loading on fast navigation, agent messages lost when restoring a session, messages stuck in "Thinking" state, suggested prompts not working when clicked, archived workspaces reappearing, "Waiting for" banner showing up again after dismissal, terminal connections dropping, assistant replies overwritten by stale saves, modal and animation glitches.

## 0.2.33

- Rich model metadata in the model picker — badges (Auto, Free), cost tier indicators ($, $$, $$$), and smarter sorting by priority.
- Terminal auto-recovery — frozen terminals now self-heal instead of requiring a manual page navigation.
- Prevents out-of-memory crashes when loading large agent conversations.
- Spec panel only opens when an agent is actively writing to it, instead of reopening on every workspace visit.
- Claude Opus 4.6 is now the default model for Auggie agents.
- Fixes: sent messages not appearing without a refresh, chat panel freezing during concurrent agent streaming, duplicate stream chunks from leaked IPC listeners, delayed user message display, thinking indicator not showing on follow-up messages, sidebar progress card flickering between PR and task status, agent list stuck in skeleton loading state after navigation, duplicate agent wake-up messages.

## 0.2.32

- Claude Opus 4.6 is now the default model for Auggie agents.
- Rich model metadata in the model picker — badges (Auto, Free), cost tier indicators ($, $$, $$$), and smarter sorting by priority.
- Terminal auto-recovery — frozen terminals now self-heal instead of requiring a manual page navigation.
- Prevents out-of-memory crashes when loading large agent conversations.
- Spec panel only opens when an agent is actively writing to it, instead of reopening on every workspace visit.
- Fixes: sent messages not appearing without a refresh, chat panel freezing during concurrent agent streaming, duplicate stream chunks from leaked IPC listeners, delayed user message display, thinking indicator not showing on follow-up messages, sidebar progress card flickering between PR and task status, agent list stuck in skeleton loading state after navigation, duplicate agent wake-up messages.

## 0.2.31

- Fixes: agents sidebar appearing empty after switching workspaces, crash when creating agents or changing workspace settings.

## 0.2.30

- Agent streaming is now resilient to workspace switching. Responses are no longer lost if you navigate away and come back while an agent is mid-reply.
- Corporate proxy support. Intent now trusts custom CA certificates from your OS certificate store, fixing connection errors behind corporate proxies.
- UI Designer specialist upgraded to a higher-quality model for better output and accessibility adherence.
- Faster startup and smaller install footprint.
- Fixes: false "stalled" or "no response" warnings while agents run MCP tools, provider selection resetting to the wrong provider during workspace creation, model selector reverting when clicking the Agent card, agent responses failing for conversations containing certain unicode characters, delegated sub-agents not appearing in the sidebar, agent sidebar not restoring after workspace switch, crash in Settings > Agents for workspaces created before the coding-agent override feature, background agents incorrectly waking unrelated coordinators, parent agent resuming too early when a child agent is interrupted.

## 0.2.29

- Agent provider and model locking. Once an agent session starts, the provider and model stay fixed for the duration of the conversation to keep context consistent.
- Fixes: previously pasted text appearing as the first message when creating a new agent.

## 0.2.28

- Fixes: crashes when creating agents, switching models, or interacting with panels in certain timing conditions, terminal panel getting stuck in an invisible state after closing the last terminal tab.

## 0.2.27

- Browser-mode rendering — Intent can now run in a regular browser while Electron is running, with full data access via an HTTP/WebSocket bridge.
- Notification MCP tool (`emit_notification`) lets external services push notifications into a workspace and wake specific agents.
- Workspace scripts now persist in `.intent/config.json` so they're shared across sessions.
- Cmd+/ shortcut wired up for the enhance-prompt action in workspace creation.
- Codex model list is now dynamic, matching the models your account has access to.
- Streaming status messages simplified — only the 90-second stalled threshold shows a warning, removing false-alarm "taking longer than usual" messages at 30s/60s.
- Fixes: agent chat not streaming on workspace revisit, user messages lost during workspace switch, optimistic messages disappearing on force-submit (⌘Enter), space bar not working in spec comments, terminal toggle requiring double-click, browser panels opening in wrong workspace, broken "Learn More" link in MCP settings, preferred model not resolving for general agents, PR not linking to review workspaces, terminal shortcuts blocked when tab bar was focused.

## 0.2.26

- Workspace Scripts — detect, manage, and run project scripts (dev servers, builds, tests) directly from the workspace.
- Bun-compiled binary fallback for Auggie install — no longer requires Node.js 22+ to get started.
- Terminal keyboard shortcuts: Cmd+T to create tabs, Cmd+W to close, Cmd+Shift+[/] to cycle between them.
- Scroll-to-previous arrow on user messages and sticky headers for easier navigation in long conversations.
- Interrupt priority for agent-to-agent messaging — agents can stop each other mid-response for urgent coordination.
- Prompt layer reordering for better sub-agent cache reuse.
- Note names are now clickable links in tool calls, with full content copy support.
- Last response group stays expanded when the response ends on it instead of auto-collapsing.
- Context pills render properly in sticky user message headers.
- SOURCE_BRANCH now available in setup scripts.
- Fixes: false "No response received" during tool execution, fullscreen tooltip from massive git error strings, merged PRs disappearing from workspace lists on refresh, duplicate queued events delivered to agents.

## 0.2.25

- Figma MCP integration available as a one-click install in Settings.
- Multiple provider support for all agent types. Mix-and-match providers across agents, specialists, and coordinators.
- Embedded browser now supports OAuth/authentication flows and displays website favicons.
- PR status refreshes automatically after a merge operation.
- Better timeouts and status messages for slow agent requests.
- Fixes: reset/archive buttons not showing when branch is fully merged to trunk, toggle indicators using wrong color in custom themes, ModelPicker not reflecting the correct model when editing previous messages, workspaces not grouped correctly when repositoryName is missing.

## 0.2.24

- Pinned projects in the sidebar now persist across app restarts.
- Edit button for suggested answers lets you tweak a suggestion before sending it.
- Slow-agent latency surfacing with provider-aware messaging so you know when a model is taking longer than expected.
- PR Shepherd is hidden when GitHub auth is not available.
- Fixes: GPT-5.4 `apply_patch` tool not detected for auto-commit attribution, oversized line-change indicators in the sidebar.

## 0.2.23

- Agent Skills — agents discover SKILL.md files from your project and gain repo-specific capabilities automatically.
- Go to Line with Cmd+G / Ctrl+G in the code editor.
- YAML front matter is now preserved in the markdown editor instead of being corrupted on save.
- Polished streaming animation with a cylinder scroller for response groups — smoother collapse, expand, and scroll behavior.
- "Use for all specialists" button in settings to apply your default model to every specialist at once.
- Editing a message pre-selects the model that was originally used for that response.
- Workspace list shows live task progress indicators without waiting for background enrichment.
- Fixes: agent stuck in "Thinking" state, message data loss on save, stale session events interleaving during transitions, stale disk data overwriting messages during HMR, inaccurate MCP connection status for HTTP/SSE servers.

## 0.2.22

- GPT-5.4 is now the default model for Auggie agents and available in the Codex model picker.
- Ralph agent — a new specialist that iterates in a work/test loop until the job is done.
- ACP session persistence: agent sessions survive app restarts instead of starting fresh.
- RTK command optimization setting with auto-detection and guided install flow.
- Sidebar workspaces now sort by most recently updated, with pinned workspaces first and a visual separator.
- Fixes: node-pty NAPI crash during workspace navigation, false-positive merge conflicts in automatic rebasing, rebase button not appearing after workspace switch, Windows setup terminal not expanding and newline issues in command execution.

## 0.2.20

- Fixes: Opencode no longer errors when running OpenAI models, agent response pollution across workspaces, agent streaming state not isolated by workspace, create_agent tool reactivity and background agent visibility, conversation-retrieval tool incorrectly displaying as "Search codebase", fix ReferenceError in model selection, hardened PR data flow with correct merged/draft state and invariant checks.

## 0.2.19

- PRs in the sidebar are now scoped to each workspace instead of showing every open PR across the repo.
- Cleaner onboarding — sidebar navigation is hidden during provider setup so you can focus on getting connected.
- Custom behavior prompts now carry through to delegated specialist agents.
- Improved accessibility across the app shell, navigation, and workspace UI.
- Visual polish for the diagram system.
- Fixes: blank agent created on workspace open, tool calls misrouted when provider titles replace tool names, stack overflow in deep clone operations, Node.js version check using the wrong PATH, workspace context menu bugs on Windows, broken links on settings and onboarding pages, provider selection desyncing when changed externally, workspace archive flicker on the home screen, stale agents blocking the spawn cap, PR status changes not reflected in workspace state, unhelpful error when Node.js installation is stale.

## 0.2.18

- Rebase-onto-trunk button to sync your worktree with the upstream trunk branch.
- Gitignored files now visible in the file tree with muted styling.
- Removed agent spawn cap enforcement, allowing more flexible delegation.
- Updated workspace MCP tool references.
- Fixes: default setup script not running for new users, setup script terminal not showing in overlay when loaded from backend, sidebar incorrectly showing "Synced" without PR or merge evidence, duplicate skeleton/follow-up tool_use blocks getting non-descriptive labels.

## 0.2.17

- PR mergeability tracking with visual status indicators. PR status now always visible in the overview changes tab, including closed PRs.
- Pagination for PR review comments and threads.
- Guardrails to prevent runaway agent spawn loops and token burn. Premature parent agent wake-ups in delegation chains are fixed.
- Hardened agent event subscriptions to prevent duplicate coordinator creation. MCP server setup for agents audited and tightened.
- Up arrow now edits queued messages instead of pulling from history.
- Hide empty repos on home page with a remove option. Overview agents card filters out delegated/background agents to match the agents tab.
- Node 22 requirement surfaced to users before Auggie install.
- Improved contrast and typography with semantic tokens. Bold selected theme name in color theme settings.
- Auto-approve permissions when the provider doesn't support bypassPermissions mode. Force git status refresh before auto-commit to detect agent changes.
- Fixes: diff rendering for committed agent file changes, OS notification workspace navigation, stale workspace enrichment data across surfaces, phantom polling for deleted workspaces, PR cache bypass on sidebar refresh, PR auto-discovery when pushed commit count changes, null toolName in tool-classifier, webviewReady guards on Electron webview calls, workspace-scoped state cleanup on deletion, Settings menu navigating to wrong window on macOS, toast notification for direct create-pr actions, sync calls blocking the main process.

## 0.2.12

- Provider auth status now shown in Settings. See at a glance whether you're logged in to Claude, Codex, or OpenCode, with a link to how to sign in if not.
- Redesigned changes panel with per-file grouping, "mark as viewed" checkboxes, and commit headers. Copy branch name from the changes panel or overview card.
- Files open in the editor now auto-refresh when an agent edits them, no more manual reload.
- Keyboard navigation in file search results. Cmd+O opens the workspace list as a sidebar panel instead of an overlay. Windows-specific editor and path handling.
- Queued messages no longer get stuck when event delivery races with stream completion.
- Fixes: spec panel not opening after background agent writes it, messages lost for navigated-to agents, directory clicks in file explorer, workspace switcher badge mismatches, transition crashes during workspace switching, and file:// URLs now work in the embedded browser.

## 0.2.11

- Optimize home page and workspace loading for faster startup.
- Choose your preferred monospace font for editors and diff viewers.
- All interactive agents now organize long responses into collapsible groups, not just the Coordinator. Think/reasoning blocks from external providers are parsed and displayed correctly.
- Workspace creation is more reliable. Duplicate agent activations are prevented and setup scripts auto-restore per repo.
- Fixes: Intel Mac support, workspace deletion errors, changes panel getting stuck on loading, spec panel not opening on existing workspaces, GitHub links now open in your browser, npm cache collisions between concurrent agents, and lifecycle events (rename, archive) now update across all windows.

## 0.2.10

- Agent responses can now be organized into collapsible groups, making long outputs easier to scan.
- New workspaces start with a single panel. The spec slides in once the agent begins writing it.
- Redesigned workspace sidebar with phase indicators and PR status pills.
- Faster workspace loading. New workspaces skip unnecessary git operations and show the streaming indicator right away.
- MCP server startup errors now surface in the UI instead of failing silently.
- Cmd+F search works in chat and notes panels. Open workspaces listed in the Window menu.
- Fixes: memory leaks on workspace close, MCP server restart loops, stale changes panel after file event drops, streaming content lost on workspace switch, fork session corruption, and queued messages now process in the background.

## 0.2.9

- Settings page reorganized for clarity.
- Agents are named by role (Coordinator, Implementor, Verifier) instead of random names.
- Per-group commit buttons in the changes panel let you commit each agent's work independently.
- Auto-commit is now respected everywhere. When you turn it off, agents will not commit on your behalf.
- Delegated agents reliably inherit their parent's provider, fixing cases where child agents could end up on the wrong model.
- Fixes: workspace title not updating for new spaces, improved agent isolation, stale messages after agent wake-ups, streaming state lost on page refresh, subscription UI reappearing after delegation, and various small UI cleanups.

## 0.2.8

- File tracking now uses Git blob storage. Diffs and file contents are stored as SHA blobs rather than inline, with lazy resolution and cached repo checks.
- Open spaces in a new window with Cmd+Click. Also added a Markdown file editor for notes and docs.
- More reliable rebase detection. We now track the HEAD SHA and use follow-up polling, so the UI refreshes correctly after both app-initiated and external rebases.
- Fixed model selection in OpenCode. Now uses session/set_model to prevent a silent fallback to OpenRouter.
- No more duplicate task agents. If the target agent is already streaming, we skip spinning up another one.
- Two small bug fixes: Atomic file writes no longer hit a race condition (solved with unique temp paths), and remote workspace git status no longer truncates filenames.

## 0.2.7

- PR Shepherd specialist for automated PR review cycles. New `wait_for_pr_changes` MCP tool and post-merge workspace reset workflow.
- Specialists in @ mentions with activity indicators. Agent-list and confirmation UI blocks in tool call display.
- xhigh reasoning effort level and expanded model list for Codex.
- Font style settings for Notes and Agent Chat.
- Auto-retry failed messages for background agents after session recovery. Smart workspace navigation on archive/delete.
- Content-based binary detection in the diff pipeline. Multi-window support via workspace-scoped IPC broadcasting.
- Fixes: auto-rebase baseSHA/stash handling, queued messages reappearing after send, "Waiting for 0 agents" ghost message, agent display delay in workspace switcher, MCP server resilience to transient bridge failures, git polling log spam, agent permanent delete from context menu, stale session writes on beforeunload, rapid token consumption guard, deferred queued messages for inactive workspaces, improved "agent process died" diagnostics, gitignore race conditions, workspace rename race, model-drop safety warning on provider switch, tool call text overlap, Windows PowerShell setup scripts.

## 0.2.6

- Material file type icons in the file tree. Dotfiles now visible, gitignore negation patterns fixed.
- Rich browser tool call display with inline screenshots. Copy button on code blocks in Spec/Note view.
- Enhance prompt button on workspace initializer. Agents available in @ mention menu.
- Window sessions restore on app reopen. Repos persist in registry across workspace deletion.
- Auto-rebase on conflict-free merge. PR mergeability and conflict detection tools. Bulk archive/delete for workspaces.
- Links open in embedded browser panel by default.
- Windows compat improvements across process spawning, path handling, and build scripts.
- Fixes: ACP process accumulation, orphaned MCP/agent processes on quit, MCP zombie restarts, process tree cleanup for terminals and git timeouts, spellcheck in notes, setup script garbled commands, auggie detection for nvm/fnm/volta, drag-and-drop file mentions, folder expansion after cache expiry, stale git status, workspace sort jumping, Claude Code provider bugs, Check for Updates hanging.

## 0.2.5

- Reasoning effort levels for Codex.
- GitHub PR comment tools in workspace MCP. Keyboard shortcuts for suggested prompts.
- Delegated agents nested under delegator in the agents list.
- Redesigned setup script editor (two-column modal). Setup script banner in terminal.
- Native FSEvents on macOS for instant git status. Background git ops across workspace nav.
- Fixes: several agent event subscription bugs, specialist model reverting, PR targeting wrong repo, EMFILE from too many watchers, streaming state in agent creation, cross-project branch/path leak, binary diff crashes.
- Snowflake Cortex provider (behind feature flag)
- Linux build infrastructure (2026 is the year of the Linux desktop?)

## v0.2.4

- Developer specialist — new agent that plans, implements, and verifies in one shot
- Merge via PR — merge through a PR or locally from the commit panel
- Splash screen with logo while the app boots
- Branch prefix preference included in agent system prompts
- E2E smoke tests across all available providers

Fixes:

- OpenCode model picker no longer reverts to the first model on every open
- Delegated agents that error now emit agent:failed so the parent wakes up
- Fixed workspace open loop, blank chat panel on switch, empty panel flash on load
- Auto-commit race condition; cascading timeout when rapidly editing messages
- Image/file attachments work across message flows; image-only messages send correctly
- Branch rename validates the old ref before trying (no more fatal)
- Ctrl+W passes through to terminal on macOS
- Misc: spaces overlay UX, new-space modal polish, sidebar icons, commit panel, loading states

## v0.2.3

2 new features:

- one-click Auggie Context Engine install for Claude Code, Codex, and OpenCode@terminal mentions — Agent can now read from and interact with terminal sessions

bunch of fixes (40+ commits):

- Auth — New browser-based login flow with polling and manual paste fallback
- Agent stability — Fixed several causes of agents getting stuck or producing corrupted output
- Tool call rendering — Cleaner display for tool calls like delegate-task and run-command
- Auto-commit — Inline status in chat, fixed empty commit messages, better local repo support
- UI polish — Theme fixes, draggable title bar, scrolling and crash fixes in editors
- Provider fixes — Fixed race conditions and bad model IDs in external provider connections
- Crash fixes — Handled various edge cases causing crashes in terminals, tooltips, and file trees

## v0.2.2

- Pasting Markdown into Notes now preserves formattingSmarter implementor agent — upgraded from "fast" to "smart" model tier
- 413 errors: context-too-large errors now gracefully reduce history instead of crashing
- Model picker was showing wrong model for delegated agents; now validates against available models
- Sidebar can move to the right (collapse)
- Removed broken auto-restart loop, added switch-back button on provider mismatch
- Tool display file paths shown properly, "Completed" status for successful tools, better error messages
- Stability: fixed sidebar scroll overflow, spurious Vite reloads, Monaco error suppression, type errors & memory leaks

## v0.2.1

- Delegated agent responses now stream to the UI in real-time instead of appearing all at once. Also fixed agents not showing up until you manually refreshed.
- File paths in agent tool output are now clickable. CLI tool calls show collapsible details.
- Long tool output is truncated before being sent back in history, preventing 413 context-length errors.
- Errors stay visible after streaming stops instead of disappearing. Simplified StreamingStatus component.
- Terminal cmd+f find works properly now.
- Misc: toast close button fix, skipWorktree UX, home grid spacing, dead feature flag cleanup.

## v0.2.0

- ACP session recovery uses a structured XML exchange format for history replay. Agent stderr is captured again.
- Needs-permission avatar state for tool calls. Previous tool calls that were never marked done now auto-complete.
- Provider-aware specialist model resolution via modelTier. Agents always launch with the resolved provider model.
- MCP servers are passed via ACP session/new instead of writing .mcp.json to the worktree.
- Workspace dirs consolidated under ~/intent/workspaces/.
- Version history UI replaced with a minimal inline diff viewer. Specialist picker simplified to a clean dropdown.
- File-like context menus (copy path, reveal) on agent and note tabs.
- Mermaid fullscreen overlay fills the viewport and scales the SVG to fit.
- Fixes: tool calls disappearing during streaming, regenerate not showing until refresh, dedup cache not clearing on regenerate, tool-call-only messages lost on edit/regenerate, double agent notifications, edit_note on empty notes, unknown language highlighting, empty error card fallback, SIGSEGV in AsyncWrap during GC.

## v0.1.69

- Agent responses no longer duplicate, fragment, or go missing. Several streaming bugs caused text to repeat, appear in the wrong message, or get lost when messages were queued. All fixed.
- Large notes no longer freeze the app. Markdown processing happens in the background now, and the file tree and git history load significantly faster.
- @ mentions got a major upgrade. Fuzzy search understands file paths, the dropdown is wider and anchored to the input, clicking a file mention opens it, and notes show their title instead of an ID.
- File management from the sidebar. Create files inline, delete with undo, right-click tabs to copy paths or reveal in Finder. "Reveal in Sidebar" works.
- Agents auto-commit after every turn, not just when a task finishes.
- Delegated agents no longer get blocked by a provider mismatch. Child agents correctly inherit their parent's provider.
- Crash recovery is better. Errors that used to blank the screen now show a useful error card with copy-to-clipboard. Benign framework errors are suppressed.
- New toast system with color-coded types (warning for destructive actions) and 15 seconds to undo.
- Spaces switcher shows workspace status, repo name, and agent activity. You can click to select.

## v0.1.68

- Fixed agent response duplication where streaming content from previous messages would bleed into new ones. Stream IDs are now unique per message turn, and chunk/complete handlers find the correct message by its streaming flag instead of assuming it is the last one.
- Provider inference no longer falls back to the legacy 'acp' protocol name. Agent provider is now extracted from compound model IDs (e.g. `opencode:haiku4.5`) so child agents, backend sessions, and the mismatch check all resolve to the real provider.
- IPC listener cleanup uses targeted `offById()` removal instead of `removeAllListeners()`, which was wiping out agent subscription listeners on stream channels. Also fixes leaked notification subscriptions on repeated workspace:open and removes the destructive visibilitychange cleanup handler.
- Cmd+backtick / Ctrl+backtick now toggles the terminal even when an input is focused (new `global` shortcut property that bypasses the input-focus check).
- Coordinator specialist now reminds agents to keep the Spec note up to date as the source of truth.
- Entrance animations on workspace page layout sections.

## v0.1.67

- "what commits are relevant" logic (in the changes sidebar) should be a bit more robust, and you can now see previous commits and manually change which ones to see
- “intent`CLI and deep-links. You can install the`intent`command from the app menu or command palette, then run`intent <repo-path>` to open a workspace. Deep-links (`intent://`) navigate to the create-workspace form with the repo pre-filled. Handles cold start, second-instance, and dev-mode paths.
- Agents are now locked to the provider they were created with. Switching providers prompts you to start a new agent instead of silently changing models mid-conversation. This prevents bad states when people switch agent providers
- Workspace root moved from `~/.workspaces` to `~/intent` (legacy paths still work).
- fixes to agent delegation and subscriptions: idle events were being dropped, stale status was sticking around, and parent agents weren't getting notified of child deletions. Also added health checks for ACP disconnections.
- Diff viewer no longer loses your scroll position when an agent edits a file. Changes tab got commit context menus, older commit loading, and proper loading states back.
- Pasting large blocks of text into chat now collapses into an inline chip instead of flooding the input.
- Assorted smaller fixes: home page loading UX, model picker fallback, code 11 CBP detection, workspace:open race condition, empty layout defaults, tool call rendering, image-only message validation.

## v0.1.66

- BYOA: now includes opencode support (on start page & setting page). this means you can use local models with Intent
- now we render Mermaid diagrams (instead of just our own diagrams)
- migrated specialists agents to a file-based format
- activity log now has live updates, improved styling, and better attribution
- fixed a number of BOYA issue. notably:
- ModelPicker: Enhanced footer, fallback logic, and settings navigation
- Settings: Add skeleton loading states for providers and integrations
- ModelPicker refactor: Make side-effect-free by default with opt-in global updates
