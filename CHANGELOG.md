# Changelog

## Releases 2.0.0 and Later

From version 2.0.0 onward, release notes are published on the [GitHub Releases page](https://github.com/intent-hq/cloudlands-releases/releases). Auto-generated entries for 2.x releases also appear below.

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
