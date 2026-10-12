import type { IconDefinition } from './icon-definition';
import {
  getPhosphorIconSymbol,
  getPhosphorIconWeight as getCanonicalPhosphorIconWeight,
  type PhosphorIconSymbol,
} from './phosphor-icon-mapping';
export * from './phosphor-icon-definitions';
import type { Component } from 'svelte';
import type { IconWeight } from 'phosphor-svelte';
import AppleLogoIcon from 'phosphor-svelte/lib/AppleLogoIcon';
import AlienIcon from 'phosphor-svelte/lib/AlienIcon';
import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
import ArrowBendUpLeftIcon from 'phosphor-svelte/lib/ArrowBendUpLeftIcon';
import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
import ArrowsInIcon from 'phosphor-svelte/lib/ArrowsInIcon';
import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOutIcon';
import ArrowsOutLineVerticalIcon from 'phosphor-svelte/lib/ArrowsOutLineVerticalIcon';
import AsteriskIcon from 'phosphor-svelte/lib/AsteriskIcon';
import AtIcon from 'phosphor-svelte/lib/AtIcon';
import BellIcon from 'phosphor-svelte/lib/BellIcon';
import BellSlashIcon from 'phosphor-svelte/lib/BellSlashIcon';
import BookIcon from 'phosphor-svelte/lib/BookIcon';
import BookOpenIcon from 'phosphor-svelte/lib/BookOpenIcon';
import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
import BrowserIcon from 'phosphor-svelte/lib/BrowserIcon';
import BugIcon from 'phosphor-svelte/lib/BugIcon';
import CakeIcon from 'phosphor-svelte/lib/CakeIcon';
import CatIcon from 'phosphor-svelte/lib/CatIcon';
import CalendarIcon from 'phosphor-svelte/lib/CalendarIcon';
import CameraIcon from 'phosphor-svelte/lib/CameraIcon';
import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
import ChalkboardTeacherIcon from 'phosphor-svelte/lib/ChalkboardTeacherIcon';
import ChartLineUpIcon from 'phosphor-svelte/lib/ChartLineUpIcon';
import ChatDotsIcon from 'phosphor-svelte/lib/ChatDotsIcon';
import ChatIcon from 'phosphor-svelte/lib/ChatIcon';
import ChatSlashIcon from 'phosphor-svelte/lib/ChatSlashIcon';
import ChatsIcon from 'phosphor-svelte/lib/ChatsIcon';
import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
import CheckSquareIcon from 'phosphor-svelte/lib/CheckSquareIcon';
import CircleHalfIcon from 'phosphor-svelte/lib/CircleHalfIcon';
import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
import ClipboardIcon from 'phosphor-svelte/lib/ClipboardIcon';
import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUpIcon';
import CloudIcon from 'phosphor-svelte/lib/CloudIcon';
import CoffeeIcon from 'phosphor-svelte/lib/CoffeeIcon';
import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
import ColumnsIcon from 'phosphor-svelte/lib/ColumnsIcon';
import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
import CopySimpleIcon from 'phosphor-svelte/lib/CopySimpleIcon';
import CornersInIcon from 'phosphor-svelte/lib/CornersInIcon';
import CornersOutIcon from 'phosphor-svelte/lib/CornersOutIcon';
import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon';
import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
import CursorTextIcon from 'phosphor-svelte/lib/CursorTextIcon';
import HandIcon from 'phosphor-svelte/lib/HandIcon';
import DatabaseIcon from 'phosphor-svelte/lib/DatabaseIcon';
import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
import DogIcon from 'phosphor-svelte/lib/DogIcon';
import DotsSixIcon from 'phosphor-svelte/lib/DotsSixIcon';
import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
import DotsThreeVerticalIcon from 'phosphor-svelte/lib/DotsThreeVerticalIcon';
import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeIcon';
import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
import FileIcon from 'phosphor-svelte/lib/FileIcon';
import FileMinusIcon from 'phosphor-svelte/lib/FileMinusIcon';
import FilePlusIcon from 'phosphor-svelte/lib/FilePlusIcon';
import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
import FileXIcon from 'phosphor-svelte/lib/FileXIcon';
import FlagIcon from 'phosphor-svelte/lib/FlagIcon';
import FlaskIcon from 'phosphor-svelte/lib/FlaskIcon';
import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDiskIcon';
import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
import FoldersIcon from 'phosphor-svelte/lib/FoldersIcon';
import FunnelIcon from 'phosphor-svelte/lib/FunnelIcon';
import GaugeIcon from 'phosphor-svelte/lib/GaugeIcon';
import GearIcon from 'phosphor-svelte/lib/GearIcon';
import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
import GitCommitIcon from 'phosphor-svelte/lib/GitCommitIcon';
import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
import GitMergeIcon from 'phosphor-svelte/lib/GitMergeIcon';
import GithubLogoIcon from 'phosphor-svelte/lib/GithubLogoIcon';
import GitlabLogoIcon from 'phosphor-svelte/lib/GitlabLogoIcon';
import GitPullRequestIcon from 'phosphor-svelte/lib/GitPullRequestIcon';
import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
import GameControllerIcon from 'phosphor-svelte/lib/GameControllerIcon';
import HammerIcon from 'phosphor-svelte/lib/HammerIcon';
import HardDriveIcon from 'phosphor-svelte/lib/HardDriveIcon';
import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon';
import HouseIcon from 'phosphor-svelte/lib/HouseIcon';
import HourglassIcon from 'phosphor-svelte/lib/HourglassIcon';
import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
import KeyboardIcon from 'phosphor-svelte/lib/KeyboardIcon';
import LaptopIcon from 'phosphor-svelte/lib/LaptopIcon';
import LightbulbIcon from 'phosphor-svelte/lib/LightbulbIcon';
import LightningIcon from 'phosphor-svelte/lib/LightningIcon';
import LinkBreakIcon from 'phosphor-svelte/lib/LinkBreakIcon';
import LinkIcon from 'phosphor-svelte/lib/LinkIcon';
import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
import ListIcon from 'phosphor-svelte/lib/ListIcon';
import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbersIcon';
import LockIcon from 'phosphor-svelte/lib/LockIcon';
import LockOpenIcon from 'phosphor-svelte/lib/LockOpenIcon';
import MagicWandIcon from 'phosphor-svelte/lib/MagicWandIcon';
import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
import MagnifyingGlassMinusIcon from 'phosphor-svelte/lib/MagnifyingGlassMinusIcon';
import MagnifyingGlassPlusIcon from 'phosphor-svelte/lib/MagnifyingGlassPlusIcon';
import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
import NoteIcon from 'phosphor-svelte/lib/NoteIcon';
import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
import PackageIcon from 'phosphor-svelte/lib/PackageIcon';
import PaletteIcon from 'phosphor-svelte/lib/PaletteIcon';
import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
import PenIcon from 'phosphor-svelte/lib/PenIcon';
import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
import PlanetIcon from 'phosphor-svelte/lib/PlanetIcon';
import PottedPlantIcon from 'phosphor-svelte/lib/PottedPlantIcon';
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
import PersonSimpleRunIcon from 'phosphor-svelte/lib/PersonSimpleRunIcon';
import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
import PlugIcon from 'phosphor-svelte/lib/PlugIcon';
import PlusCircleIcon from 'phosphor-svelte/lib/PlusCircleIcon';
import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
import PlusMinusIcon from 'phosphor-svelte/lib/PlusMinusIcon';
import ProhibitIcon from 'phosphor-svelte/lib/ProhibitIcon';
import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
import PuzzlePieceIcon from 'phosphor-svelte/lib/PuzzlePieceIcon';
import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
import QuotesIcon from 'phosphor-svelte/lib/QuotesIcon';
import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
import RocketIcon from 'phosphor-svelte/lib/RocketIcon';
import ShieldIcon from 'phosphor-svelte/lib/ShieldIcon';
import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';
import SpinnerGapIcon from 'phosphor-svelte/lib/SpinnerGapIcon';
import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
import StackIcon from 'phosphor-svelte/lib/StackIcon';
import StarIcon from 'phosphor-svelte/lib/StarIcon';
import StopIcon from 'phosphor-svelte/lib/StopIcon';
import StudentIcon from 'phosphor-svelte/lib/StudentIcon';
import TerminalIcon from 'phosphor-svelte/lib/TerminalIcon';
import TestTubeIcon from 'phosphor-svelte/lib/TestTubeIcon';
import TextAaIcon from 'phosphor-svelte/lib/TextAaIcon';
import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeftIcon';
import TextBIcon from 'phosphor-svelte/lib/TextBIcon';
import TextItalicIcon from 'phosphor-svelte/lib/TextItalicIcon';
import TextStrikethroughIcon from 'phosphor-svelte/lib/TextStrikethroughIcon';
import TextUnderlineIcon from 'phosphor-svelte/lib/TextUnderlineIcon';
import ThumbsDownIcon from 'phosphor-svelte/lib/ThumbsDownIcon';
import ThumbsUpIcon from 'phosphor-svelte/lib/ThumbsUpIcon';
import TicketIcon from 'phosphor-svelte/lib/TicketIcon';
import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
import TreeStructureIcon from 'phosphor-svelte/lib/TreeStructureIcon';
import UploadSimpleIcon from 'phosphor-svelte/lib/UploadSimpleIcon';
import UserIcon from 'phosphor-svelte/lib/UserIcon';
import UserPlusIcon from 'phosphor-svelte/lib/UserPlusIcon';
import UsersIcon from 'phosphor-svelte/lib/UsersIcon';
import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
import WaveformIcon from 'phosphor-svelte/lib/WaveformIcon';
import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
import XIcon from 'phosphor-svelte/lib/XIcon';

export {
  AlienIcon,
  CatIcon,
  CloudIcon,
  CoffeeIcon,
  DesktopIcon,
  DogIcon,
  GameControllerIcon,
  GhostIcon,
  HardDrivesIcon,
  LaptopIcon,
  PlanetIcon,
  PottedPlantIcon,
  RobotIcon,
  RocketIcon,
};

export type { IconDefinition } from './icon-definition';

const iconComponents = {
  AppleLogoIcon,
  ArchiveIcon,
  ArrowBendUpLeftIcon,
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  ArrowsInIcon,
  ArrowsInLineVerticalIcon,
  ArrowsLeftRightIcon,
  ArrowsOutIcon,
  ArrowsOutLineVerticalIcon,
  AsteriskIcon,
  AtIcon,
  BellIcon,
  BellSlashIcon,
  BookIcon,
  BookOpenIcon,
  BrainIcon,
  BrowserIcon,
  BugIcon,
  CakeIcon,
  CalendarIcon,
  CameraIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  ChalkboardTeacherIcon,
  ChartLineUpIcon,
  ChatDotsIcon,
  ChatIcon,
  ChatSlashIcon,
  ChatsIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  CircleHalfIcon,
  CircleIcon,
  ClipboardIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CloudIcon,
  CodeIcon,
  ColumnsIcon,
  CopyIcon,
  CopySimpleIcon,
  CornersInIcon,
  CornersOutIcon,
  CrosshairIcon,
  CubeIcon,
  CursorClickIcon,
  CursorTextIcon,
  DatabaseIcon,
  DesktopIcon,
  DotsSixIcon,
  DotsThreeIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  EnvelopeIcon,
  EyeIcon,
  EyeSlashIcon,
  FileCodeIcon,
  FileIcon,
  FileMinusIcon,
  FilePlusIcon,
  FileTextIcon,
  FileXIcon,
  FlagIcon,
  FlaskIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FoldersIcon,
  FunnelIcon,
  GaugeIcon,
  GearIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitDiffIcon,
  GitForkIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  GitlabLogoIcon,
  GlobeIcon,
  HammerIcon,
  HandIcon,
  HardDriveIcon,
  HardDrivesIcon,
  HourglassIcon,
  HouseIcon,
  ImageIcon,
  InfoIcon,
  KeyIcon,
  KeyboardIcon,
  LaptopIcon,
  LightbulbIcon,
  LightningIcon,
  LinkBreakIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListNumbersIcon,
  LockIcon,
  LockOpenIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MicrophoneIcon,
  MinusIcon,
  MoonIcon,
  NoteIcon,
  NotePencilIcon,
  PackageIcon,
  PaletteIcon,
  PaperPlaneTiltIcon,
  PaperclipIcon,
  PauseIcon,
  PenIcon,
  PenNibIcon,
  PencilSimpleIcon,
  PersonSimpleRunIcon,
  PlayIcon,
  PlugIcon,
  PlusCircleIcon,
  PlusIcon,
  PlusMinusIcon,
  ProhibitIcon,
  PushPinIcon,
  PuzzlePieceIcon,
  QrCodeIcon,
  QuestionIcon,
  QuotesIcon,
  RobotIcon,
  RocketIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SpinnerGapIcon,
  SquareIcon,
  StackIcon,
  StarIcon,
  StopIcon,
  StudentIcon,
  TerminalIcon,
  TestTubeIcon,
  TextAaIcon,
  TextAlignLeftIcon,
  TextBIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TicketIcon,
  TrashIcon,
  TreeStructureIcon,
  UploadSimpleIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  WarningCircleIcon,
  WarningIcon,
  WaveformIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} satisfies Record<PhosphorIconSymbol, Component<any>>;

export function getPhosphorIconComponent(iconDefinition: IconDefinition): Component<any> {
  return iconComponents[getPhosphorIconSymbol(iconDefinition)];
}

export function getPhosphorIconWeight(iconDefinition: IconDefinition): IconWeight {
  return getCanonicalPhosphorIconWeight(iconDefinition);
}
