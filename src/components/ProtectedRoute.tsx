import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export const ProtectedRoute: React.FC<{ children: React.ReactNode, requireAdmin?: boolean }> = ({ children, requireAdmin = false }) => {
  const { user, role, loading, isApproved } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-light flex items-center justify-center">
        <div className="text-primary font-bold text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isApproved && user.email !== 'kanata840@gmail.com') {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireAdmin && role !== 'admin' && user.email !== 'kanata840@gmail.com') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
