'use client';

import { use, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/common/Navbar';
import { 
  ArrowLeft, User, Mail, Phone, Calendar, Clock, 
  FileText, Activity, ShieldAlert, CheckCircle2, XCircle, AlertCircle
} from 'lucide-react';

export default function PatientHistoryPage({ params }) {
  const { id } = use(params);
  const { user, token, API_BASE_URL } = useAuth();
  const router = useRouter();

  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Navigation Guard
  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user]);

  useEffect(() => {
    if (!user || !id) return;

    const fetchPatientHistory = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/patients/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          throw new Error(`Failed to retrieve clinical record. Status: ${res.status}`);
        }
        const data = await res.json();
        setPatient(data);
      } catch (err) {
        console.error('Error fetching patient history:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPatientHistory();
  }, [id, user]);

  if (!user) return null;

  const sortedAppointments = patient?.appointments
    ? [...patient.appointments].sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate))
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 sm:p-8 space-y-8">
        
        {/* Navigation Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>

          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs font-extrabold uppercase tracking-wider border border-teal-500/20">
            <Activity className="h-3 w-3" />
            Clinical Records
          </span>
        </div>

        {/* Loading / Error States */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="pulse-loader">
              <div></div>
              <div></div>
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-400">Loading patient timeline records...</p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-500 flex items-start gap-4">
            <AlertCircle className="h-6 w-6 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-extrabold text-lg">Failed to load record</h3>
              <p className="text-sm mt-1">{error}</p>
              <p className="text-xs text-slate-400 mt-2">Verify that the backend server is running and your account has permissions.</p>
            </div>
          </div>
        ) : !patient ? (
          <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <ShieldAlert className="h-12 w-12 text-slate-400 mx-auto" />
            <h3 className="mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">Patient Not Found</h3>
            <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">The requested patient record could not be located in the directory.</p>
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-3">
            
            {/* Demographics Column (Left) */}
            <div className="md:col-span-1 space-y-6">
              <div className="glass p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg flex flex-col items-center text-center">
                <div className="h-20 w-20 rounded-full bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-600 dark:text-teal-400 mb-4 shadow-inner">
                  <User className="h-10 w-10" />
                </div>
                <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">{patient.name}</h2>
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xxs font-extrabold uppercase bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 mt-1.5">
                  {patient.gender} • {patient.age} yrs
                </span>

                <div className="w-full border-t border-slate-100 dark:border-slate-800/80 my-6"></div>

                <div className="w-full space-y-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="truncate">{patient.phoneNumber}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="truncate">{patient.email || 'No email provided'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                    <span>Registered: {new Date(patient.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Medical history & timeline Column (Right) */}
            <div className="md:col-span-2 space-y-8">
              
              {/* Anamnesis history block */}
              <div className="glass p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-teal-600" />
                  <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                    Clinical Background & Anamnesis
                  </h3>
                </div>
                <div className="p-4 rounded-xl bg-slate-100/50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/80">
                  <p className="text-slate-700 dark:text-slate-300 leading-6 text-sm font-semibold whitespace-pre-line">
                    {patient.medicalHistory || 'No previous clinical history or chronic conditions registered for this patient.'}
                  </p>
                </div>
              </div>

              {/* Consultation Timeline Section */}
              <div className="space-y-4">
                <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide px-1">
                  Consultation Timeline
                </h3>

                {sortedAppointments.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                    <Calendar className="h-10 w-10 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No Consultations Recorded</p>
                    <p className="text-xs text-slate-400 mt-1">This patient has no appointments scheduled or completed.</p>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 pl-6 space-y-8">
                    {sortedAppointments.map((app) => (
                      <div key={app.id} className="relative group">
                        
                        {/* Timeline Bullet Point */}
                        <div className="absolute -left-[31px] top-1.5 h-4 w-4 rounded-full border-2 border-white dark:border-slate-950 bg-teal-600 group-hover:scale-125 transition-transform"></div>

                        <div className="glass p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md hover:border-teal-500/30 transition-all duration-300 space-y-3">
                          <div className="flex flex-wrap justify-between items-start gap-2">
                            <div className="flex items-center gap-2 text-xs font-extrabold text-slate-500">
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{new Date(app.appointmentDate).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
                              <span className="text-slate-300 dark:text-slate-700">•</span>
                              <Clock className="h-3.5 w-3.5" />
                              <span>{new Date(app.appointmentDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>

                            <span className={`inline-flex px-2 py-0.5 rounded text-xxs font-extrabold tracking-wide uppercase ${app.status === 'COMPLETED' ? 'bg-teal-500/10 text-teal-600' : app.status === 'CANCELLED' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                              {app.status}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                              Objective: <span className="font-semibold text-slate-600 dark:text-slate-400">{app.reason || 'General Health Consultation'}</span>
                            </h4>
                            
                            <div className="text-xs text-slate-500 leading-5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                              <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">Physician Notes Summary:</span>
                              {app.status === 'COMPLETED' ? (
                                <p className="italic text-slate-600 dark:text-slate-400">
                                  Patient attended consultation. Objective: &quot;{app.reason || 'General wellness check'}&quot; was successfully completed. Recommended follow-up as needed.
                                </p>
                              ) : app.status === 'CANCELLED' ? (
                                <p className="text-rose-500/85">
                                  Consultation was cancelled. Patient slot was released.
                                </p>
                              ) : (
                                <p className="italic text-amber-500/85">
                                  Pending consultation slot. Waiting for active receptionist check-in.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
