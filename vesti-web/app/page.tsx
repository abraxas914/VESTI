'use client';

import { VestiDashboard, type StorageApi } from '@vesti/ui';
import {
  getConversations,
  getTopics,
  runGardener,
  getRelatedConversations,
  getAllEdges,
  getMessages,
  getAnnotationsByConversation,
  saveAnnotation,
  deleteAnnotation,
  exportAnnotationToNote,
  exportAnnotationToNotion,
  updateConversation,
  updateConversationTitle,
  deleteConversation,
  renameFolderTag,
  moveFolderTag,
  removeFolderTag,
  askKnowledgeBase,
  getNotes,
  saveNote,
  updateNote,
  deleteNote,
  getSummary,
  generateSummary,
  getStorageUsage,
  exportData,
  clearAllData,
} from '@/lib/storageService';

export default function VestiDashboardPage() {
  return (
    <VestiDashboard
      logoSrc="/favicon.svg"
      storage={{
        getConversations,
        getTopics,
        runGardener,
        getRelatedConversations,
        getAllEdges,
        getMessages,
        getAnnotationsByConversation,
        saveAnnotation,
        deleteAnnotation,
        exportAnnotationToNote,
        exportAnnotationToNotion,
        updateConversation,
        updateConversationTitle,
        deleteConversation,
        renameFolderTag,
        moveFolderTag,
        removeFolderTag,
        askKnowledgeBase,
        getNotes,
        saveNote,
        updateNote,
        deleteNote,
        getSummary,
        generateSummary,
        getStorageUsage,
        exportData,
        clearAllData,
      } satisfies StorageApi}
    />
  );
}
