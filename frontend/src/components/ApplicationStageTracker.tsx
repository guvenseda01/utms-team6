import { CheckCircle, X, AlertCircle } from 'lucide-react'
import type { AppStatus, HistoryEntry } from '../types/application'

interface Stage {
  key: AppStatus
  en: string
  tr: string
}

// Exact order from backend _STATUS_ORDER in domain/application.py
const STAGES: Stage[] = [
  { key: 'DRAFT', en: 'Draft', tr: 'Taslak' },
  { key: 'SUBMITTED', en: 'Submitted', tr: 'Başvuru Alındı' },
  { key: 'UNDER_REVIEW', en: 'Under Review', tr: 'İncelemede' },
  { key: 'ENGLISH_REVIEW', en: 'English Review', tr: 'İngilizce Değerlendirme' },
  { key: 'DEAN_APPROVED', en: "Dean's Review", tr: 'Dekanlık İncelemesi' },
  { key: 'DEPT_EVAL', en: 'Department Evaluation', tr: 'Bölüm Değerlendirmesi' },
  { key: 'RANKING', en: 'Ranking', tr: 'Sıralama' },
  { key: 'ANNOUNCED', en: 'Announced', tr: 'Sonuçlandı' },
]

type StageState = 'completed' | 'active' | 'pending' | 'rejected' | 'warning'

interface ApplicationStageTrackerProps {
  currentStatus: AppStatus | null | undefined
  history?: HistoryEntry[]
  language?: 'en' | 'tr'
}

export function ApplicationStageTracker({
  currentStatus,
  history = [],
  language = 'tr',
}: ApplicationStageTrackerProps) {
  // Special handling for CORRECTION_REQUESTED: treat as UNDER_REVIEW being active with warning
  const displayStatus = currentStatus === 'CORRECTION_REQUESTED' ? 'UNDER_REVIEW' : currentStatus
  const isCorrectionRequested = currentStatus === 'CORRECTION_REQUESTED'
  const isRejected = currentStatus === 'REJECTED'

  // For rejection, find the status before REJECTED in history
  let rejectedFromStatus: AppStatus | null = null
  if (isRejected && history.length > 0) {
    // Find the last non-REJECTED status before current REJECTED status
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status !== 'REJECTED') {
        rejectedFromStatus = history[i].status
        break
      }
    }
  }

  const statusToUse = isRejected && rejectedFromStatus ? rejectedFromStatus : displayStatus
  const currentIndex = STAGES.findIndex(s => s.key === statusToUse)

  function getState(index: number): StageState {
    if (currentIndex === -1) return 'pending'

    // Handle rejection: find last completed stage and mark it red
    if (isRejected) {
      if (index < currentIndex) return 'completed'
      if (index === currentIndex) return 'rejected'
      return 'pending'
    }

    // Normal flow
    if (index < currentIndex) return 'completed'
    if (index === currentIndex) return isCorrectionRequested ? 'warning' : 'active'
    return 'pending'
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-8">Application Progress</h2>

      {/* Horizontal tracker — desktop */}
      {!isMobile && (
        <div className="relative">
          <div className="flex items-start">
            {STAGES.map((stage, index) => {
              const state = getState(index)
              const isCompleted = state === 'completed'
              const isActive = state === 'active'
              const isPending = state === 'pending'
              const isRejectedState = state === 'rejected'
              const isWarning = state === 'warning'

              return (
                <div key={stage.key} className="flex-1 flex flex-col items-center relative">
                  {/* Circle + label */}
                  <div className="mb-3 z-10">
                    {/* Completed: green with checkmark */}
                    {isCompleted && (
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                        <CheckCircle className="w-6 h-6 text-white" />
                      </div>
                    )}
                    {/* Active: blue border with number */}
                    {isActive && (
                      <div className="w-10 h-10 rounded-full border-3 border-blue-500 flex items-center justify-center bg-white shadow-md ring-2 ring-blue-200 ring-offset-2">
                        <span className="text-sm font-bold text-blue-600">{index + 1}</span>
                      </div>
                    )}
                    {/* Warning (correction requested): orange/yellow with alert icon */}
                    {isWarning && (
                      <div className="w-10 h-10 rounded-full border-3 border-amber-500 flex items-center justify-center bg-amber-50 shadow-md ring-2 ring-amber-200 ring-offset-2">
                        <AlertCircle className="w-5 h-5 text-amber-600" />
                      </div>
                    )}
                    {/* Pending: gray border with number */}
                    {isPending && (
                      <div className="w-10 h-10 rounded-full border-2 border-gray-300 flex items-center justify-center bg-white">
                        <span className="text-sm font-semibold text-gray-400">{index + 1}</span>
                      </div>
                    )}
                    {/* Rejected: red with X */}
                    {isRejectedState && (
                      <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                        <X className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Labels */}
                  <p
                    className={`text-xs font-medium text-center ${
                      isCompleted
                        ? 'text-green-600'
                        : isActive
                          ? 'text-blue-600'
                          : isWarning
                            ? 'text-amber-600'
                            : isRejectedState
                              ? 'text-red-600'
                              : 'text-gray-400'
                    }`}
                  >
                    {language === 'en' ? stage.en : stage.tr}
                  </p>

                  {/* Connector line to next stage */}
                  {index < STAGES.length - 1 && (
                    <div
                      className="absolute top-5 left-1/2 h-0.5"
                      style={{
                        width: `calc(100% - 1.25rem)`,
                        backgroundColor:
                          isCompleted || isWarning ? '#10b981' : isRejectedState ? '#ef4444' : '#d1d5db',
                        zIndex: 0,
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Vertical tracker — mobile */}
      {isMobile && (
        <div className="space-y-4">
          {STAGES.map((stage, index) => {
            const state = getState(index)
            const isCompleted = state === 'completed'
            const isActive = state === 'active'
            const isPending = state === 'pending'
            const isRejectedState = state === 'rejected'
            const isWarning = state === 'warning'

            return (
              <div key={stage.key}>
                <div className="flex items-start gap-3">
                  {/* Circle + connector */}
                  <div className="flex flex-col items-center">
                    {/* Completed: green with checkmark */}
                    {isCompleted && (
                      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                        <CheckCircle className="w-5 h-5 text-white" />
                      </div>
                    )}
                    {/* Active: blue border with number */}
                    {isActive && (
                      <div className="w-8 h-8 rounded-full border-2 border-blue-500 flex items-center justify-center bg-white shadow-md ring-2 ring-blue-200">
                        <span className="text-xs font-bold text-blue-600">{index + 1}</span>
                      </div>
                    )}
                    {/* Warning: orange/yellow with alert icon */}
                    {isWarning && (
                      <div className="w-8 h-8 rounded-full border-2 border-amber-500 flex items-center justify-center bg-amber-50 shadow-md ring-2 ring-amber-200">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                      </div>
                    )}
                    {/* Pending: gray border with number */}
                    {isPending && (
                      <div className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center bg-white">
                        <span className="text-xs font-semibold text-gray-400">{index + 1}</span>
                      </div>
                    )}
                    {/* Rejected: red with X */}
                    {isRejectedState && (
                      <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                        <X className="w-5 h-5 text-white" />
                      </div>
                    )}

                    {/* Vertical connector */}
                    {index < STAGES.length - 1 && (
                      <div
                        className="w-0.5 h-8 mt-1"
                        style={{
                          backgroundColor:
                            isCompleted || isWarning ? '#10b981' : isRejectedState ? '#ef4444' : '#d1d5db',
                        }}
                      />
                    )}
                  </div>

                  {/* Label */}
                  <div className="pt-0.5">
                    <p
                      className={`text-sm font-medium ${
                        isCompleted
                          ? 'text-green-600'
                          : isActive
                            ? 'text-blue-600'
                            : isWarning
                              ? 'text-amber-600'
                              : isRejectedState
                                ? 'text-red-600'
                                : 'text-gray-400'
                      }`}
                    >
                      {language === 'en' ? stage.en : stage.tr}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Correction Requested message */}
      {isCorrectionRequested && (
        <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {language === 'en' ? 'Correction Requested' : 'Düzeltme Talep Edildi'}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {language === 'en'
                ? 'Please re-upload your documents with the requested corrections.'
                : 'Lütfen talep edilen düzeltmelerle birlikte belgelerinizi yeniden yükleyin.'}
            </p>
          </div>
        </div>
      )}

      {/* Rejection message */}
      {isRejected && (
        <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">
              {language === 'en' ? 'Application Rejected' : 'Başvuru Reddedildi'}
            </p>
            <p className="text-xs text-red-700 mt-1">
              {language === 'en'
                ? 'Your application has been rejected. Please contact the administration for more information.'
                : 'Başvurunuz reddedilmiştir. Daha fazla bilgi için yönetimle iletişime geçiniz.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
